# `@ubiquity-os/daemon-pricing`

Helps settings prices and adds label to the issues accordingly.

## Usage

Example of valid configuration:

```yml
- plugin: https://ubiquity-os-daemon-pricing.ubq.fi
  with:
    labels:
      time:
        - name: "Time: <1 Hour"
          collaboratorOnly: false
        - name: "Time: <2 Hours"
          collaboratorOnly: false
        - name: "Time: <4 Hours"
          collaboratorOnly: false
        - name: "Time: <1 Day"
          collaboratorOnly: false
        - name: "Time: <1 Week"
          collaboratorOnly: false
      priority:
        - name: "Priority: 1 (Normal)"
          collaboratorOnly: false
        - name: "Priority: 2 (Medium)"
          collaboratorOnly: true
        - name: "Priority: 3 (High)"
          collaboratorOnly: false
        - name: "Priority: 4 (Urgent)"
          collaboratorOnly: false
        - name: "Priority: 5 (Emergency)"
          collaboratorOnly: false
    basePriceMultiplier: 1
    publicAccessControl:
      setLabel: true
      fundExternalClosedIssue: false
      protectLabels:
        - price
        - time
        - priority
    globalConfigUpdate:
      excludeRepos: ["devpool-directory", "devpool-directory-private"]
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
