// Cog Serverless Utility
// (C) 2025 Kalan Dominick (domkalan) MIT License
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const nunjucks = require('nunjucks');
const bodyParser = require('body-parser');
const hat = require('hat');
const randomstring = require('randomstring');
const nodeCron = require('node-cron');
const childProcess = require('child_process');
const { rimrafSync } = require('rimraf');

// Create our http and express servers
const app = express()
const server = http.createServer(app);

// Express specific middleware for parsing post body
app.use(bodyParser.urlencoded())
app.use(bodyParser.json())

const runtime = {
    scripts: []
}

const addCronTrigger = (cogFile) => {
    const task = nodeCron.schedule(cogFile.cronSchedule, () => {
        console.log(`Running cog script ${cogFile.id} from cron schedule`);

        runScript(cogFile.id, [[`--time=${Math.floor(Date.now() / 1000)}`]], null)
    });

    cogFile._cronTask = task;
}

const runScript = (cogScriptId, context, message) => {
    const cogScript = runtime.scripts.find(i => i.id === cogScriptId);

    if (!cogScript) {
        console.error(`Could not locate cog script ${cogScriptId} in runtime`);

        return;
    }

    // define runtime file
    const cogScriptFile = path.resolve(`./data/scripts/${cogScript.id}/${cogScript.entrypoint}`)

    // variables for the spawned processes
    let spawnedProcess = null;
    let spawnedProcessRunning = true;
    let spawnedProcessMessageSent = false;

    // handle runtimes
    if (cogScript.runtime === 'nodejs') {
        spawnedProcess = childProcess.spawn('node', [cogScriptFile, ...context], { stdio: ['pipe', 'pipe', 'pipe'] });
    }

    // watch for exit
    spawnedProcess.on('exit', () => {
        spawnedProcessRunning = false;

        console.log(`Cog script ${cogScript.id} has exited`);
    });

    spawnedProcess.stdout.on('data', (data) => {
        const output = data.toString();

        console.log(`Cog script ${cogScript.id}: ${output}`)

        
        if (output.includes('message:')) {
            spawnedProcess.stdin.write(message + '\n' || '\n');
        }
    });

    // if running longer than 30s, call timeout and kill
    setTimeout(() => {
        if (spawnedProcessRunning) {
            console.warn(`Cog script ${cogScript.id} exceed execution time window`);
        }

        // if process is active still, kill it
        if (spawnedProcess !== null && !spawnedProcess.killed) {
            // cleanup
            spawnedProcess.removeAllListeners();
            spawnedProcess.removeAllListeners();

            // kill process
            spawnedProcess.kill();
        }
    }, cogScript.timeout);

    return spawnedProcess;
}

// Create nunjucks
const nunjucksLoader = new nunjucks.FileSystemLoader(path.resolve('./views'), { noCache: true });
const nunjucksInstance = new nunjucks.Environment(nunjucksLoader, { noCache: true });

// Attach nunjucks to express
nunjucksInstance.express(app);

// Default index route redirection
app.get('/', (req, res) => {
    res.redirect('/ui');
})

// UI catch all for authentication
app.use('/ui', (req, res, next) => {
    // TODO: Expand this in the future for pulling from db
    const auth = { login: 'admin', password: process.env.UI_SECRET || 'cogui' }

    // parse login and password from headers
    const b64auth = (req.headers.authorization || '').split(' ')[1] || ''
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':')

    // Verify login and password are set and correct
    if (login && password && login === auth.login && password === auth.password) {
        return next()
    }

    // Access denied...
    res.set('WWW-Authenticate', 'Basic realm="401"') // change this
    res.status(401).send('Authentication required.') // custom message
});

// UI home page
app.get('/ui', (req, res) => {
    const scripts = runtime.scripts.map(i => { return { id: i.id, name: i.name, runtime: i.runtime } })

    res.render('ui/home.html', { scripts: scripts });
});

// display website based editor
app.get('/ui/new', (req, res) => {
    res.render('ui/new.html');
});

// handle incoming data for new scripts
app.post('/ui/new', (req, res) => {
    // generate an id
    const id = hat();
    const secret = randomstring.generate(32);

    // create the script data dir
    fs.mkdirSync(path.resolve(`./data/scripts/${id}`));

    // create the script entry
    const entryFile = {
        id: id,
        created: Math.floor(Date.now() / 1000),
        updated: Math.floor(Date.now() / 1000),

        name: req.body.name,
        runtime: req.body.runtime,
        webhook: req.body.webhook,
        cron: req.body.cron,
        cronSchedule: req.body.cronSchedule,
        entrypoint: null,
        timeout: 30000
    }

    // write the script file
    if (req.body.runtime === 'nodejs') {
        entryFile.entrypoint = 'app.js';

        fs.writeFileSync(path.resolve(`./data/scripts/${id}/app.js`), req.body.code);
    }

    // write the script entry file
    fs.writeFileSync(path.resolve(`./data/scripts/${id}/.cog`), JSON.stringify(entryFile, null, 4))

    // add to runtime
    runtime.scripts.push(entryFile);

    // if cron, pass to cron scheduler
    if (req.body.cron) {
        addCronTrigger(entryFile);
    }

    res.json({ id })
});

// Route for loading scripts
app.get('/ui/scripts/:script', (req, res) => {
    const script = runtime.scripts.find(i => i.id === req.params.script);

    if (!script) {
        res.status(404);
        res.send('404');

        return;
    }

    res.render('ui/script.html', { script: {
        id: script.id,
        name: script.name,
        runtime: script.runtime
    } });
});

// Route for fetching raw scripts for html code editor
app.get('/ui/scripts/:script/raw', (req, res) => {
    const script = runtime.scripts.find(i => i.id === req.params.script);

    if (!script) {
        res.status(404);
        res.send('404');

        return;
    }

    res.send(fs.readFileSync(path.resolve(`./data/scripts/${script.id}/${script.entrypoint}`)).toString());
});

// Update existing scripts
app.post('/ui/scripts/:script', (req, res) => {
    const script = runtime.scripts.find(i => i.id === req.params.script);

    if (!script) {
        res.status(404);
        res.send('404');

        return;
    }

    fs.writeFileSync(path.resolve(`./data/scripts/${script.id}/${script.entrypoint}`), req.body.code)

    res.json({ id: script.id });
});

// Delete scripts
app.delete('/ui/scripts/:script', (req, res) => {
    const script = runtime.scripts.find(i => i.id === req.params.script);

    if (!script) {
        res.status(404);
        res.send('404');

        return;
    }

    if (typeof script._cronTask !== 'undefined') {
        script._cronTask.destroy().then(() => {
            console.log(`Cog cron task for ${script.id} destroyed`)
        })
    }

    rimrafSync(path.resolve(`./data/scripts/${script.id}`));

    runtime.scripts = runtime.scripts.filter(i => i.id !== script.id);

    res.json({ id: null });
});

// Web API for loading cog scripts
app.post('/api/v1/trigger/:script', (req, res) => {
    const cogScript = runtime.scripts.find(i => i.id === req.params.script);

    // check if cog script exists
    if (!cogScript) {
        console.error(`Could not locate cog script ${req.params.script} in runtime`);

        res.status(404)
        res.json({ message: 'The requested script could not be found.' })

        return;
    }

    // are webhooks enabled?
    if (!cogScript.webhook) {
        res.status(400)
        res.json({ message: 'The requested script does not have webhooks enabled.' })
    }

    // flatten query into command line args
    const context = [];

    for(const queryVar of Object.keys(req.query)) {
        context.push(`--${queryVar}="${req.query[queryVar]}"`)
    }

    runScript(cogScript.id, context, JSON.stringify(req.body));

    res.send({ message: 'Script execution has been triggered.' })
});

// Web API for executing scripts
app.post('/api/v1/run/:script', (req, res) => {
    const cogScript = runtime.scripts.find(i => i.id === req.params.script);

    // check if cog script exists
    if (!cogScript) {
        console.error(`Could not locate cog script ${req.params.script} in runtime`);

        res.status(404)
        res.json({ message: 'The requested script could not be found.' })

        return;
    }

    // are webhooks enabled?
    if (!cogScript.webhook) {
        res.status(400)
        res.json({ message: 'The requested script does not have webhooks enabled.' })
    }

    // flatten query into command line args
    const context = [];

    for(const queryVar of Object.keys(req.query)) {
        context.push(`--${queryVar}="${req.query[queryVar]}"`)
    }

    const child = runScript(cogScript.id, context, JSON.stringify(req.body));

    let consoleOutput = '';
    let consoleError = '';

    child.stdout.on('data', (data) => {
        consoleOutput += data.toString();
    });

    child.stderr.on('data', (data) => {
        consoleOutput += data.toString();
        consoleError += data.toString();
    });

    child.on('exit', () => {
        res.send({ message: 'Script has executed successfully!', output: consoleOutput, outputError: consoleError });
    });
});

// launch the server
server.listen(3000, '0.0.0.0', () => {
    console.log('Cog is online 0.0.0.0:3000')

    // check and make sure directories exist
    if (!fs.existsSync(path.resolve('./data'))) {
        fs.mkdirSync(path.resolve('./data'))
    }

    // check and make sure directories exist
    if (!fs.existsSync(path.resolve('./data/scripts'))) {
        fs.mkdirSync(path.resolve('./data/scripts'))
    }

    // Get all stored scripts
    const scripts = fs.readdirSync(path.resolve('./data/scripts'));

    // Reload scripts
    for(const script of scripts) {
        if (!fs.existsSync(path.resolve(`./data/scripts/${script}/.cog`))) {
            console.log(`Script ${script} is missing .cog file, skipping`)

            continue;
        }

        const cogFile = JSON.parse(fs.readFileSync(path.resolve(`./data/scripts/${script}/.cog`)).toString());

        runtime.scripts.push(cogFile);

        if (cogFile.cron) {
            addCronTrigger(cogFile);
        }

        console.log(`Cog script ${cogFile.id} loaded into runtime`);
    }
});
