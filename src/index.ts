/**
 * @license
 *  Copyright 2020 Qlever LLC
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

import config from './config.js';

import '@oada/pino-debug';

import HJSON from 'hjson';
import _debug from 'debug';
import addresses from 'email-addresses';
import asyncHandler from 'express-async-handler';
import express from 'express';
import got from 'got';
import multer from 'multer';
// Import DKIM from 'dkim'
import mailparser from 'mailparser';

import { Counter } from '@oada/lib-prom';
import { connect } from '@oada/client';

import { trellisDocumentsTree } from './trees.js';

const port = config.get('port');
const domain = config.get('oada.domain');
const token = config.get('oada.token');

// Comma separated list of domains
const dkimlist = config.get('dkim_whitelist');
// Comma separated list of domains or emails
const whitelist = config.get('whitelist');
// Comma separated list of domains or emails
const blacklist = config.get('blacklist');

const warn = _debug('trellis-sendgrid-ingest:warn');
const info = _debug('trellis-sendgrid-ingest:info');
const debug = _debug('trellis-sendgrid-ingest:debug');
const trace = _debug('trellis-sendgrid-ingest:trace');

const emailCounter = new Counter({
  name: 'incoming_emails_total',
  help: 'Total number of emails received',
});

const conn = await connect({
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
  asyncHandler(async (request, response) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    info({ email: request.body }, 'Handling incoming email');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const {
      from,
      to,
      subject,
      dkim: sgdkim,
      email,
    }: InboundMail = request.body;

    /**
     * Parsed from address
     */
    const addr = addresses.parseOneAddress(from);
    if (!(addr && 'address' in addr)) {
      throw new TypeError(`Failed to parse from address: ${from}`);
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
      HJSON.parse(sgdkim.replace('{', '{\n').replace('}', '\n}')) as Record<
        string,
        unknown
      >
    ).map(([key, value]) => ({
      verified: value === 'pass',
      signature: { domain: key.slice(1) },
    }));
    trace(dkim, 'DKIM');
    // Use DKIM to check for spoofing of from
    if (dkim.length === 0) {
      // Require DKIM to be present?
      response.end();
      return;
    }

    // Check for DKIM from one of the allowed domains
    if (dkimlist.every((it) => dkim.some((d) => d.signature.domain !== it))) {
      debug(dkimlist, 'DKIM domain not in whitelist');
      response.end();
      return;
    }

    debug('Received email (%s) from: %s to: %s', subject, from, to);

    // Check whitelist
    if (whitelist.every((it) => addr.address !== it && addr.domain !== it)) {
      // Neither address nor domain of from was in whitelist
      warn('Email not in whitelist (%s) from: %s to: %s', subject, from, to);
      response.end();
      return;
    }

    // Check blacklist
    if (blacklist.some((it) => addr.address === it || addr.domain === it)) {
      warn('Blacklisted email (%s) from: %s to: %s', subject, from, to);
      response.end();
      return;
    }

    // Parse email attachments
    const { attachments } = await mailparser.simpleParser(email);
    for await (const { cid, filename, contentType, content } of attachments) {
      debug('Working on attachment %s', cid);

      if (contentType !== 'application/pdf') {
        return;
      }

      const r = await got({
        url: `${domain}/resources`,
        method: 'post',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/pdf',
          // "Content-Length": file.size,
          'Transfer-Encoding': 'chunked',
        },
        json: content,
      });

      // Put filename in meta
      await conn.put({
        path: `${r.headers['content-location']}/_meta`,
        contentType: 'application/json',
        data: {
          filename,
        },
      });

      if (!r.headers['content-location']) {
        throw new Error(r.statusMessage);
      }

      const { headers } = await conn.post({
        path: '/bookmarks/trellisfw/documents',
        tree: trellisDocumentsTree,
        // eslint-disable-next-line no-secrets/no-secrets
        contentType: 'application/vnd.trellisfw.document.1+json',
        data: {
          pdf: { _id: r.headers['content-location'].slice(1), _rev: 0 },
        },
      });

      trace('Created Trellis document: %s', headers['content-location']);
    }

    response.end();
    emailCounter.inc();
  })
);

app.listen(port, () => {
  info('Listening on port %d', port);
});
