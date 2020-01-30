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

import https from "https";

import Promise from "bluebird";
import express from "express";
import multer from "multer";
import axios from "axios";
import asyncHandler from "express-async-handler";
import oada from "@oada/oada-cache";
import debug from "debug";

import config from "./config.js";
import { trellisDocumentsTree } from "./trees.js";

const port = config.get("port");
const domain = config.get("domain");
const token = config.get("token");

const info = debug("trellis-sendgrid-ingrest:info");

const con = oada.default.connect({
  domain,
  token,
  cache: false // Just want `oada-cache` for it's tree stuff
});

const upload = multer({
  limits: {
    files: 10,
    fileSize: 20 * 1024 * 1024 // 20 MB
  }
});

const app = express();

app.post(
  "/",
  upload.any(),
  asyncHandler(async function(req, res) {
    const c = await con;
    let from = req.body.from;
    let to = req.body.to;
    let subject = req.body.subject;

    info(`Recieved email (${subject}) from: ${from} to: ${to}`);

    return Promise.each(req.files, async file => {
      if (file.mimetype !== "application/pdf") {
        return;
      }

      let r = await axios({
        url: `${domain}/resources`,
        method: "post",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/pdf",
          //"Content-Length": file.size,
          "Transfer-Encoding": "chunked"
        },
        data: file.buffer
      });

      if (!r.headers["content-location"]) {
        throw new Error(r);
      }

      let doc = await c.post({
        path: "/bookmarks/trellisfw/documents",
        tree: trellisDocumentsTree,
        header: {
          "Content-Type": "application/vnd.trellisfw.document.1+json"
        },
        data: {
          pdf: { _id: r.headers["content-location"].substr(1), _rev: 0 }
        }
      });

      info(`Created Trellis document: ${doc.headers["content-location"]}`);

      res.end();
    });
  })
);

var server = app.listen(port, function() {
  console.log("Listening on port %d", server.address().port);
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
