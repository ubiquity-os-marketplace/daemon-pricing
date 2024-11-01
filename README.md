# `@ubiquity-os/daemon-pricing`

Helps settings prices and adds label to the issues accordingly.

## Usage

Example of valid configuration:

```yml
 - plugin: https://ubiquibot-assistive-pricing.ubq.fi
   type: github
   with:
     labels:
       time:
         - "Time: <1 Hour"
         - "Time: <2 Hours"
         - "Time: <4 Hours"
         - "Time: <1 Day"
         - "Time: <1 Week"
       priority:
         - "Priority: 1 (Normal)"
         - "Priority: 2 (Medium)"
         - "Priority: 3 (High)"
         - "Priority: 4 (Urgent)"
         - "Priority: 5 (Emergency)"
     basePriceMultiplier: 1
     fundContributorClosedIssue: false
```

## Running locally

### Supabase

Supabase can be started through the CLI running

```shell
supabase start
```

### Worker

Start the Worker by running

```shell
yarn worker
```

### Make requests

To trigger the worker, `POST` requests should be made to http://localhost:4000 with a `Content-Type: application/json`
header and a body
looking like

```json
{
  "stateId": "",
  "eventName": "",
  "eventPayload": "",
  "settings": "",
  "ref": ""
}
```

For convenience you can find an `.http` file with a valid request [here](/tests/http/request.http).

## Testing

### Jest

To start Jest tests, run

```shell
yarn test
```
