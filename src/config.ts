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

import convict from 'convict';
import { config as load } from 'dotenv';

load();

const config = convict({
  oada: {
    domain: {
      doc: 'OADA API domain',
      format: String,
      default: 'https://smithfield.trellis.one',
      env: 'DOMAIN',
      arg: 'domain',
    },
    token: {
      doc: 'OADA API token',
      format: String,
      default: 'def',
      env: 'TOKEN',
      arg: 'token',
    },
  },
  /*
   * Add more config stuff when needed
   */
  port: {
    format: 'port',
    default: 8888,
  },
  whitelist: {
    format: Array,
    default: [] as string[],
    env: 'WHITELIST',
  },
  dkim_whitelist: {
    format: Array,
    default: [] as string[],
    env: 'DKIM_WHITELIST',
  },
  blacklist: {
    format: Array,
    default: [] as string[],
    env: 'BLACKLIST',
  },
});

/**
 * Error if our options are invalid.
 * Warn if extra options found.
 */
config.validate({ allowed: 'warn' });

export default config;
