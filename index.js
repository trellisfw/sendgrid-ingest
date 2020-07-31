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

import Promise from 'bluebird'
import express from 'express'
import multer from 'multer'
import axios from 'axios'
import asyncHandler from 'express-async-handler'
import oada from '@oada/oada-cache'
import debug from 'debug'
import addrs from 'email-addresses'
import DKIM from 'dkim'
import mailparser from 'mailparser'

import config from './config.js'
import { trellisDocumentsTree } from './trees.js'

const port = config.get('port')
const domain = config.get('domain')
const token = config.get('token')

function splitList (list) {
  return list ? list.split(/,\s*/) : []
}
// Comma separated list of domains or emails
const whitelist = splitList(config.get('whitelist'))
// Comma separated list of domains or emails
const blacklist = splitList(config.get('blacklist'))

const info = debug('trellis-sendgrid-ingest:info')
const trace = debug('trellis-sendgrid-ingest:trace')

const con = oada.default.connect({
  domain,
  token,
  cache: false // Just want `oada-cache` for it's tree stuff
})

const upload = multer({
  limits: {
    files: 10,
    fileSize: 20 * 1024 * 1024 // 20 MB
  }
})

const app = express()

app.post(
  '/',
  upload.any(),
  asyncHandler(async function (req, res) {
    const c = await con

    /**
     * @type {{
     *   from: string,
     *   to: string,
     *   subject: string,
     *   dkim: string,
     *   email: string
     * }}
     * @see {@link https://sendgrid.com/docs/for-developers/parsing-email/setting-up-the-inbound-parse-webhook/ }
     */
    const { from, to, subject, dkim: sgdkim, email } = req.body

    // Use DKIM to check for spoofing of from
    const addr = addrs.parseOneAddress(from)
    /**
     * The types included with dkim suck
     * @type {{verified: boolean, status: string, signature: DKIM.Signature}[]}
     */
    const dkim = await Promise.fromNode(done =>
      DKIM.verify(Buffer.from(email), done)
    )
    trace(`Sendgrid DKIM: ${sgdkim}`)
    trace('DKIM: %O', dkim)
    if (dkim.length === 0) {
      // Require DKIM to be present?
      return res.end()
    }
    for (const { verified, status, signature } of dkim) {
      // Find signature for from domain
      // Allows from to be child domain of signature
      if (('.' + addr.domain).endsWith('.' + signature.domain)) {
        continue
      }

      if (verified) {
        break
      }

      trace(`Messgage failed DKIM check, status: ${status}`)
      switch (status) {
        case DKIM.TEMPFAIL:
          // Let sendrid try again later
          return res.send(500)
        default:
          return res.end()
      }
    }

    info(`Recieved email (${subject}) from: ${from} to: ${to}`)

    // Check whitelist
    if (whitelist.every(it => addr.address !== it && addr.domain !== it)) {
      // Neither address nor domain of from was in whitelist
      info(`Email not in whitelist (${subject}) from: ${from} to: ${to}`)
      return res.end()
    }
    // Check blacklist
    if (blacklist.some(it => addr.address === it || addr.domain === it)) {
      info(`Blacklisted email (${subject}) from: ${from} to: ${to}`)
      return res.end()
    }

    // Parse email attachments
    const { attachments } = await mailparser.simpleParser(email)
    await Promise.each(
      attachments,
      async ({ cid, filename, contentType, content }) => {
        info(`Working on attachment ${cid}`)

        if (contentType !== 'application/pdf') {
          return
        }

        const r = await axios({
          url: `${domain}/resources`,
          method: 'post',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/pdf',
            // "Content-Length": file.size,
            'Transfer-Encoding': 'chunked'
          },
          data: content
        })

        // Put filename in meta
        await c.put({
          path: `${r.headers['content-location']}/_meta`,
          headers: {
            'Content-Type': 'application/json'
          },
          data: {
            filename
          }
        })

        if (!r.headers['content-location']) {
          throw new Error(r)
        }

        const { headers } = await c.post({
          path: '/bookmarks/trellisfw/documents',
          tree: trellisDocumentsTree,
          headers: {
            'Content-Type': 'application/vnd.trellisfw.document.1+json'
          },
          data: {
            pdf: { _id: r.headers['content-location'].substr(1), _rev: 0 }
          }
        })

        info(`Created Trellis document: ${headers['content-location']}`)
      }
    )

    res.end()
  })
)

var server = app.listen(port, function () {
  info('Listening on port %d', server.address().port)
})

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
