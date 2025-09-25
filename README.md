# Cog

Lightweight function runner with Webhook and Cron scheduling support.

Cog is a tiny, file-backed server for running user-provided scripts (currently Node.js) on-demand via webhooks or on a cron schedule. It provides a simple web UI for creating/editing scripts, a small API for triggering or running scripts programmatically, and a minimal runtime with timeouts and basic input/output handling.

This project is intentionally small and easy to self-host. It is a good fit for personal automation, prototyping, or as a learning tool for simple serverless-style workflows.

## Features

- Web UI for creating, editing, and deleting scripts
- Webhook trigger endpoint for asynchronous execution
- Direct run endpoint which returns the script output after completion
- Cron scheduling using cron expressions (node-cron)
- File-based persistence in `./data/scripts` (each script has a `.cog` descriptor)
- Simple Basic Auth for the UI (configurable via `UI_SECRET`)
- Runtime isolation by spawning child processes and enforcing a per-script timeout

## Quick start

Requirements:

- Node.js 16+ (tested)
- npm

Install dependencies and start the server:

```bash
npm install
node server.js
```

By default the server listens on port 3000 and binds to 0.0.0.0.

You can also build and run the included Dockerfile (optional):

```bash
docker build -t cog .
docker run -p 3000:3000 --env UI_SECRET=mysecret_cog
```

## UI

The web UI is served under `/ui`. It is protected by Basic Auth. Default credentials are:

- login: `admin`
- password: `cogui`

To change the UI password set the `UI_SECRET` environment variable before launching the server:

```bash
UI_SECRET=supersecret node server.js
```

From the UI you can create new scripts (name, runtime, webhook toggle, cron toggle and schedule, and code). Cog currently supports Node.js scripts with an `app.js` entrypoint.

## API

Cog exposes two primary HTTP endpoints for programmatic use:

- POST /api/v1/trigger/:script
  - Asynchronously trigger a script (webhook style). If the script is configured with `webhook: true`, this will spawn the process and return immediately.
  - Query string parameters are passed into the script as command-line args in the form `--key="value"`.
  - JSON body is forwarded to the script. If the script prints a line containing `message:` the server will send the JSON body to the script's stdin.

- POST /api/v1/run/:script
  - Run the script and wait for it to finish. Returns the captured stdout/stderr when the child process exits.
  - Same query-string / JSON body behavior as `/trigger`.

Example: trigger a script named `abc123` with a query parameter and JSON body

```bash
curl -X POST 'http://localhost:3000/api/v1/trigger/abc123?who=world' \
  -H 'Content-Type: application/json' \
  -d '{"hello":"from curl"}'
```

## Script layout and .cog descriptor

Scripts live under `./data/scripts/<id>/`. Each script has a `.cog` JSON file that describes metadata and an entrypoint (for nodejs the entrypoint is `app.js`). Example `.cog`:

```json
{
  "id": "abc123",
  "created": 1690000000,
  "updated": 1690000000,
  "name": "My Script",
  "runtime": "nodejs",
  "webhook": true,
  "cron": false,
  "cronSchedule": "",
  "entrypoint": "app.js",
  "timeout": 30000
}
```

When you create a script from the UI, Cog writes the `.cog` file and the entrypoint file for you.

## Example Node script

A minimal `app.js` that reads command-line flags and optionally accepts a JSON message via stdin:

```js
// app.js
const fs = require('fs');

const args = process.argv.slice(2);
console.log('args:', args.join(' '));

// If the server sees output containing 'message:' it will write the webhook body to stdin.
// So you can prompt for input like this:
console.log('message: send json');

let input = '';
process.stdin.on('data', (d) => { input += d.toString() });
process.stdin.on('end', () => {
  if (input) {
    try {
      const body = JSON.parse(input);
      console.log('received body:', body);
    } catch (e) {
      console.error('failed to parse body');
    }
  }
});

// Keep the process alive a short moment so caller can send stdin
setTimeout(() => process.exit(0), 1000);
```

## Cron scheduling

When creating/editing a script you can enable `cron` and provide a `cronSchedule` string in standard cron format (the server uses `node-cron`). Scripts with cron enabled will be scheduled on server start and when added via the UI.

Example cron schedule (every minute):

```
* * * * *
```

## Internal behavior and notes

- Runtime: Cog currently supports `nodejs` scripts only. The server spawns processes with `child_process.spawn('node', [entrypoint, ...context])`.
- Timeouts: `.cog.timeout` controls the maximum execution window in milliseconds (default 30000 ms). The server will kill long-running child processes.
- Persistence: Scripts are stored on disk under `./data/scripts` and are reloaded on server start. There is no database.
- UI auth: Basic Auth is used. This is not a full authentication solution—do not expose to untrusted networks without extra protections.

## Development

Install, run, and edit `server.js`. Changes to views can be made in the `views/` folder. Scripts are stored under `data/scripts/`.

```bash
npm install
node server.js
```

Run tests / lint: (no tests provided yet)

## Contributing

Contributions are welcome. Open issues or PRs for bugs, improvements, or new runtimes (Python, Bash, etc.). Keep changes small and focused.

## License

This project is released under the MIT License. See `LICENSE` for details.

## Author

Kalan Dominick (domkalan)
