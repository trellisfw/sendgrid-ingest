/**
 * @license
 * Copyright 2021 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-secrets/no-secrets */

export const trellisDocumentsTree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    trellisfw: {
      _type: 'application/vnd.trellisfw.1+json',
      _rev: 0,
      documents: {
        '_type': 'application/vnd.trellisfw.documents.1+json',
        '_rev': 0,
        '*': {
          _type: 'application/vnd.trellisfw.document.1+json',
          _rev: 0,
          pdf: {
            _type: 'application/pdf',
            _rev: 0,
          },
        },
      },
    },
  },
} as const;
