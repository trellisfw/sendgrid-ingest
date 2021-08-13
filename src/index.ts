/* Copyright 2020 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint import/no-absolute-path: [2, { commonjs: false, esmodule: false }] */

import Bluebird from 'bluebird';
import express from 'express';
import multer from 'multer';
import axios from 'axios';
import asyncHandler from 'express-async-handler';
import { connect } from '@oada/client';
import debug from 'debug';
import addrs from 'email-addresses';
//import DKIM from 'dkim'
import mailparser from 'mailparser';
import HJSON from 'hjson';

import config from './config';
import { trellisDocumentsTree } from './trees';

const port = config.get('port');
const domain = config.get('oada.domain');
const token = config.get('oada.token');

// Comma separated list of domains
const dkimlist = config.get('dkim_whitelist');
// Comma separated list of domains or emails
const whitelist = config.get('whitelist');
// Comma separated list of domains or emails
const blacklist = config.get('blacklist');

const info = debug('trellis-sendgrid-ingest:info');
const trace = debug('trellis-sendgrid-ingest:trace');

const con = connect({
  domain,
  token,
});

const upload = multer({
  limits: {
    files: 10,
    fileSize: 20 * 1024 * 1024, // 20 MB
  },
});

const app = express();

/**
 * @see {@link https://sendgrid.com/docs/for-developers/parsing-email/setting-up-the-inbound-parse-webhook/ }
 */
interface InboundMail {
  from: string;
  to: string;
  subject: string;
  dkim: string;
  email: string;
}

app.post(
  '/',
  upload.any(),
  asyncHandler(async function (req, res) {
    const c = await con;

    const { from, to, subject, dkim: sgdkim, email }: InboundMail = req.body;
    trace(email);

    /**
     * Parsed from address
     */
    const addr = addrs.parseOneAddress(from);
    if (!(addr && 'address' in addr)) {
      throw new Error(`Failed to parse from address: ${from}`);
    }
    /**
     * The types included with dkim suck
     * @type {{verified: boolean, status: string, signature: DKIM.Signature}[]}
     */
    /* TODO: Figure out why this is broken
    const dkim = await Promise.fromNode(done =>
      DKIM.verify(Buffer.from(email), done)
    )
    */
    trace(sgdkim, 'Sendgrid DKIM');
    const dkim = Object.entries(
      HJSON.parse(sgdkim.replace('{', '{\n').replace('}', '\n}'))
    ).map(([key, value]) => ({
      verified: value === 'pass',
      signature: { domain: key.substring(1) },
    }));
    trace(dkim, 'DKIM');
    // Use DKIM to check for spoofing of from
    if (dkim.length === 0) {
      // Require DKIM to be present?
      return res.end();
    }
    // Check for DKIM from one of the allowed domains
    if (
      dkimlist.every((it) => dkim.some((dkim) => dkim.signature.domain !== it))
    ) {
      trace(dkimlist, 'DKIM domain not in whitelist');
      return res.end();
    }

    info('Recieved email (%s) from: %s to: %s', subject, from, to);

    // Check whitelist
    if (whitelist.every((it) => addr.address !== it && addr.domain !== it)) {
      // Neither address nor domain of from was in whitelist
      info('Email not in whitelist (%s) from: %s to: %s', subject, from, to);
      return res.end();
    }
    // Check blacklist
    if (blacklist.some((it) => addr.address === it || addr.domain === it)) {
      info('Blacklisted email (%s) from: %s to: %s', subject, from, to);
      return res.end();
    }

    // Parse email attachments
    const { attachments } = await mailparser.simpleParser(email);
    await Bluebird.each(
      attachments,
      async ({ cid, filename, contentType, content }) => {
        info('Working on attachment %s', cid);

        if (contentType !== 'application/pdf') {
          return;
        }

        const r = await axios({
          url: `${domain}/resources`,
          method: 'post',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/pdf',
            // "Content-Length": file.size,
            'Transfer-Encoding': 'chunked',
          },
          data: content,
        });

        // Put filename in meta
        await c.put({
          path: `${r.headers['content-location']}/_meta`,
          contentType: 'application/json',
          data: {
            filename,
          },
        });

        if (!r.headers['content-location']) {
          throw new Error(r.toString());
        }

        const { headers } = await c.post({
          path: '/bookmarks/trellisfw/documents',
          tree: trellisDocumentsTree,
          contentType: 'application/vnd.trellisfw.document.1+json',
          data: {
            pdf: { _id: r.headers['content-location'].substr(1), _rev: 0 },
          },
        });

        info('Created Trellis document: %s', headers['content-location']);
      }
    );

    res.end();
  })
);

app.listen(port, function () {
  info('Listening on port %d', port);
});

/*

import Promise from 'bluebird'
import debug from 'debug'
import email from '@sendgrid/mail'
import Handlebars from 'handlebars'
import axios from 'axios'

import { JobQueue } from '@oada/oada-jobs'

import config from './config.js'

const trace = debug('abalonemail:trace')
const info = debug('abalonemail:info')
const warn = debug('abalonemail:warn')
const error = debug('abalonemail:error')

const domain = 'https://' + config.get('domain')
const token = config.get('token')
const apiKey = config.get('emailKey')
// TODO: Should the from be set per task?
const from = config.get('from')

email.setApiKey(apiKey)

// Use is /bookmarks/services/abalonemail/jobs
const service = new JobQueue('abalonemail', abalonemail, {
  concurrency: 1,
  domain,
  token
})

async function abalonemail (
  id,
  { to, subject, text, html, templatePath, attachments = [], ...rest },
  conn
) {
  info('μservice triggered')

  // attachemnts is array of OADA paths or objects
  attachments = await Promise.map(attachments, attachment =>
    // Normalize attachments
    typeof attachment === 'object' ? attachment : { path: attachment }
  ).map(async ({ path, filename, ...props }, i) => {
    // Load and encode contents
    trace(`Fetching attachment from ${id}${path}`)
    path = `/resources/${id}${path}`

    // TODO: Find out why oada-cache breaks binary
    // const { data, headers } = await conn.get({ path })
    const { data, headers } = await axios.get(path, {
      baseURL: domain,
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer'
    })
    const content = data.toString('base64')
    const type = headers['content-type']
    filename = filename || `attachment_${i}`

    return { content, type, filename, ...props }
  })

  // Process handlebars templates
  if (templatePath) {
    info('Filling in handlebars templates')
    const path = `/resources/${id}${templatePath}`

    const { data } = await conn.get({ path })
    trace(data)

    text = text && Handlebars.compile(text)(data)
    html = html && Handlebars.compile(html)(data)
  }

  const msg = {
    from,
    to,
    subject,
    text,
    html,
    attachments,
    ...rest
  }

  info(`Sending email for task ${id}`)
  trace(msg)
  return email.send(msg)
}

service.start().catch(error)
  */
