# sendgrid-ingest

This microservice ingests Sendgrid `parse` emails and adds any PDF attachments to trellis' `documents` queue
at /bookmarks/trellisfw/documents.

## Installation
```bash
cd /path/to/your/oada-srvc-docker
cd services-available
git clone git@github.com:trellisfw/sendgrid-ingest.git
cd ../services-enabled
ln -s ../services-available/sendgrid-ingest
```

## Overriding defaults for production
Using `z_tokens/docker-compose.yml` method from `oada-srvc-docker`:
```docker-compose
  sendgrid-ingest:
    environment:
      - token=aproductiontoken
      - domain=https://your.trellis.domain
      - blacklist=someone_to_blacklist@email.com
```
