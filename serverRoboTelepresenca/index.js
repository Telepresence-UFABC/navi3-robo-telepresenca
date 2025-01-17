import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { v4 } from "uuid";
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { networkInterfaces } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const interfaces = networkInterfaces();
const ip = Object.keys(interfaces).reduce((result, name) => {
    const addresses = interfaces[name]
        .filter((net) => net.family === "IPv4" && !net.internal)
        .map((net) => net.address);
    return addresses.length ? addresses[0] : result;
});

const app = express();
const port = 3000;

const SETUP = {
    SERVER_IP: ip,
    INTERVAL: 0.5,
    WIDTH: 320,
    HEIGHT: 240,
    EXPRESSION_DETECTION_PROGRAM: join(__dirname, "expression_detection/expression_detection.py"),
    FACE_DETECTOR_PATH: join(__dirname, "expression_detection/haarcascade_frontalface_default.xml"),
    INTERFACE_MEDIA_PROGRAM: join(__dirname, "../interface_media/media.py")
};

// writes to setup.json
writeFileSync(join(__dirname, "public/server_setup/setup.json"), JSON.stringify(SETUP, null, 4));

// updates setup.js
writeFileSync(
    join(__dirname, "public/frontend_setup/setup.js"),
    Object.entries(SETUP).reduce(
        (acc, [k, v]) => acc + `const ${k} = ${typeof v === "number" ? String(v) : `"${v}"`} \n`,
        ""
    )
);

// Middleware
app.set("view engine", "ejs");
app.use([express.json(), express.static("public")]);

// Configuracao de servidor websocket na mesma porta do servidor web
const wsServer = new WebSocketServer({ noServer: true });

const server = app.listen(port);

// Handling de request do servidor soquete
wsServer.on("connection", function (connection) {
    const userID = v4();
    clients[userID] = { connection, messages: [] };
    console.log("Server: Connection established");

    connection.on("close", () => handleDisconnect(userID));

    connection.on("message", function (message) {
        message = JSON.parse(message.toString());
        switch (message.type) {
            case "messages":
                clients[userID].messages = message.messages;
                distributeData({ type: "pose", pan: state.pan, tilt: state.tilt }, 0);
                distributeData({ type: "fex", fex: state.fex }, 0);
                break;
            case "pose":
                console.log(message);

                state.pan = message.pan;
                state.tilt = message.tilt;

                distributeData({ type: "pose", pan: state.pan, tilt: state.tilt }, userID);
                break;
            case "fex":
                console.log(message);

                state.fex = message.fex === "ND" ? "N" : message.fex;

                distributeData({ type: "fex", fex: state.fex }, userID);
                break;
            case "interface_video":
                distributeData(message, userID);
                break;
            case "rtc":
                distributeData(message, userID);
                break;
            default:
                console.log(`Unsupported message type: ${message.type}`);
                break;
        }
    });
});

// Mudanca de protocolo de http para ws
server.on("upgrade", (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.emit("connection", ws, req);
    });
});

// clients = todos usuarios conectados ao servidor ws
const clients = {};

// envia um arquivo json para todos os usuarios conectados ao servidor ws
function distributeData(message, userID) {
    const data = JSON.stringify(message);
    Object.entries(clients).forEach(([ID, client]) => {
        if (client.connection.readyState !== WebSocket.OPEN) {
            return;
        }
        if (ID !== userID && client.messages.includes(message.type)) {
            client.connection.send(data);
        }
    });
}

function handleDisconnect(userID) {
    console.log(`${userID} disconnected.`);
    delete clients[userID];
}

const state = {
    pan: 0,
    tilt: 0,
    fex: "N",
};

// GET

// Homepage
app.get("/", function (req, res) {
    res.render("pages/index");
});

// Pagina para controlar sistema embarcado
app.get("/control", function (req, res) {
    res.render("pages/control");
});

// Pagina para mostrar as expressões faciais
app.get("/expression", function (req, res) {
    res.render("pages/expression");
});

const expressionDetection = spawn("python3", [SETUP.EXPRESSION_DETECTION_PROGRAM]);

expressionDetection.stderr.on("data", (data) => {
    console.log(`[EXPRESSION_DETECTION]: ${data}`);
});

process.on("SIGINT", () => {
    console.log("Server is killing subprocesses before terminating");
    expressionDetection.kill();
    process.exit();
});
