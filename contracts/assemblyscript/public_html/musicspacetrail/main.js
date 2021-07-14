import { insertVisualizationObjects, setVisualizationTime } from './visualizer.js';

/*const nearconfig = {
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://wallet.mainnet.near.org',
    helperUrl: 'https://helper.mainnet.near.org',
    networkId: 'mainnet',
    contractName: 'psalomo.near',
    deps: {
        keyStore: null
    }
};*/

const nearconfig = {
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    networkId: 'testnet',
    contractName: 'sellnft.testnet',
    deps: {
        keyStore: null
    }
};
nearconfig.deps.keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();

const timeSlider = document.getElementById('timeslider');
const currentTimeSpan = document.getElementById('currenttimespan');
const infopanel = document.getElementById('info');
const transactionstatus = document.getElementById('transactionstatus');

const wasmbuffersize = 128;
const SERIALIZE_TIME_RESOLUTION = 8;
const COLUMNS_PER_BEAT = 8;
let bpm;
let wasm_bytes;
let eventlist;

let endBufferNo;
let endOfSong;
let initPromise;
let audioWorkletNode;
let playing = false;
let visualizationObjects;

const audioContext = new AudioContext();

function bufferNoToTimeString(bufferNo, sampleRate) {
    const time = bufferNo * wasmbuffersize / sampleRate;
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time - minutes * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export async function byteArrayToBase64(data) {
    return await new Promise(r => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result.split('base64,')[1]);
        fr.readAsDataURL(new Blob([data]));
    });
}

async function createListenRequest(token_id, remix_token_id) {
    transactionstatus.innerHTML = `authorizing content download ${remix_token_id ? '(2 credits)' : '(1 credit)'}`;
    try {
        const account = walletConnection.account();

        const listenRequestPassword = await byteArrayToBase64(crypto.getRandomValues(new Uint8Array(64)));
        const listenRequestPasswordHash = await byteArrayToBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(listenRequestPassword)));
        await account.functionCall(nearconfig.contractName, 'request_listening', {
            token_id: `${token_id}`,
            listenRequestPasswordHash: listenRequestPasswordHash,
            remix_token_id: `${remix_token_id}`
        });
        return listenRequestPassword;
    } catch (e) {
        if (e.message.indexOf('No listening credit')>-1) {
            transactionstatus.innerHTML = 'not enough credits';
        } else {
            transactionstatus.innerHTML = e.message;
        }
        throw(e);
    }
}

async function getTokenContent(token_id, listenRequestPassword) {
    const account = walletConnection.account();
    return await account.viewFunction(nearconfig.contractName, 'get_token_content_base64',
        {
            token_id: `${token_id}`,
            caller: account.accountId,
            listenRequestPassword: listenRequestPassword
        });
}

async function getRemixTokenContent(token_id, listenRequestPassword) {
    const account = walletConnection.account();
    return await account.viewFunction(nearconfig.contractName, 'get_remix_token_content',
        {
            token_id: `${token_id}`,
            caller: account.accountId,
            listenRequestPassword: listenRequestPassword
        }
    );
}

async function buyListeningCredit(amount) {
    await walletConnection.account().functionCall(nearconfig.contractName, 'buy_listening_credit', {},
        null, nearApi.utils.format.parseNearAmount('' + amount));
}
window.buyListeningCredit = buyListeningCredit;

async function viewListeningCredit() {
    const account = walletConnection.account();
    const result = await account.viewFunction(nearconfig.contractName, 'view_listening_credit', { account: account.accountId });
    document.getElementById('creditscount').innerHTML = `${result}`;
    if (result > 1) {
        document.getElementById('controlpanel').style.display = 'block';
    }
}

function base64ToByteArray(base64encoded) {
    return ((str) => new Uint8Array(str.length).map((v, n) => str.charCodeAt(n)))(atob(base64encoded));
}

async function loadMusic(tokenId, remimxTokenId) {
    const listenRequestPassword = await createListenRequest(tokenId, remimxTokenId);
    transactionstatus.innerHTML = 'getting instrument NFT'
    wasm_bytes = pako.ungzip(base64ToByteArray((await getTokenContent(tokenId, listenRequestPassword)).replaceAll(/\"/g, '')));
    eventlist = {};
    visualizationObjects = [];

    transactionstatus.innerHTML = 'getting sequence NFT';
    const mixtokendata = await getRemixTokenContent(remimxTokenId, listenRequestPassword);
    let musicdata = pako.ungzip(base64ToByteArray(mixtokendata.split(';')[3]));
    transactionstatus.innerHTML = '';

    const numparts = musicdata[0];

    let n = 1;
    const parts = [];

    for (let partno = 0; partno < numparts; partno++) {
        const channel = musicdata[n];
        const numnotes = musicdata[n + 1];
        const numcontrollers = musicdata[n + 2];
        n += 3;
        const controllersndx = n + (numnotes * 4);
        const nextchannelndx = controllersndx + (numcontrollers * 3);
        parts[partno] = {
            events: [],
            visualizationObjects: []
        };

        while (n < controllersndx) {
            const evtstart = musicdata[n++] / SERIALIZE_TIME_RESOLUTION;
            const duration = musicdata[n++] / SERIALIZE_TIME_RESOLUTION;
            const noteNumber = musicdata[n++];
            const velocityValue = musicdata[n++];
            parts[partno].events.push({ pos: evtstart, message: [0x90 + channel, noteNumber, velocityValue] });
            parts[partno].events.push({ pos: evtstart + duration, message: [0x90 + channel, noteNumber, 0] });
            parts[partno].visualizationObjects.push(
                {
                    time: evtstart,
                    duration: duration,
                    channel: channel,
                    noteNumber: noteNumber,
                    velocityValue: velocityValue
                });
        }
        while (n < nextchannelndx) {
            const evtstart = musicdata[n++] / SERIALIZE_TIME_RESOLUTION;
            const controllerNumber = musicdata[n++];
            const controllerValue = musicdata[n++];
            parts[partno].events.push({ pos: evtstart, message: [0xb0 + channel, controllerNumber, controllerValue] });
        }
    }

    const mixerdatapos = n;

    bpm = musicdata[mixerdatapos + 32];
    const beatposToBufferNo = (pos) => Math.round((pos * 60 / bpm) * audioContext.sampleRate / wasmbuffersize);
    const addEvent = (pos, data) => {
        const bufferno = beatposToBufferNo(pos);
        if (!eventlist[bufferno]) {
            eventlist[bufferno] = [];
        }
        eventlist[bufferno].push(data);
    };

    musicdata.slice(mixerdatapos, mixerdatapos + 32)
        .forEach((v, ndx) => {
            const channel = Math.floor(ndx / 2);
            if (ndx % 2 === 0) {
                addEvent(0, [0xb0 + channel, 7, v]);
            } else {
                addEvent(0, [0xb0 + channel, 10, v]);
            }
        });

    let partschedulelength = musicdata[mixerdatapos + 34];
    let partschedulendx = mixerdatapos + 35;

    const partschedule = [];
    for (let psch = 0; psch < partschedulelength; psch++) {
        partschedule.push({
            beat: musicdata[partschedulendx++],
            part: musicdata[partschedulendx++],
            repeat: musicdata[partschedulendx++]
        });
    }

    let partlengthsndx = partschedulendx;
    parts.forEach((part) => {
        part.length = musicdata[partlengthsndx++];
    });

    endOfSong = 0;
    partschedule.forEach((psch) => {
        const part = parts[psch.part];

        const numberOfTimesToPlayPart = psch.repeat + 1;
        const endOfRepeatedParts = psch.beat + (part.length * numberOfTimesToPlayPart);
        if (endOfRepeatedParts > endOfSong) {
            endOfSong = endOfRepeatedParts;
        }
        for (let repeatCount = 0; repeatCount < numberOfTimesToPlayPart; repeatCount++) {
            part.events.forEach((evt) => {
                addEvent(evt.pos + psch.beat + part.length * repeatCount, evt.message);
            });
            part.visualizationObjects.forEach((visualizationObject) => {
                visualizationObjects.push(Object.assign({}, visualizationObject,
                    { time: visualizationObject.time + psch.beat + part.length * repeatCount }));
            });
        }
    });
    endBufferNo = beatposToBufferNo(endOfSong);
    timeSlider.max = endBufferNo;
}

let bufferno = 0;

async function initPlay() {
    await audioContext.audioWorklet.addModule('./audioworkletprocessor.js?1');
    audioWorkletNode = new AudioWorkletNode(audioContext, 'eventlist-and-wasmsynth-audio-worklet-processor', {
        outputChannelCount: [2]
    });
    audioWorkletNode.port.start();
    audioWorkletNode.port.postMessage({
        wasm: wasm_bytes,
        eventlist: eventlist,
        endBufferNo: endBufferNo
    });
    audioWorkletNode.connect(audioContext.destination);

    const messageLoop = () => {
        audioWorkletNode.port.postMessage({ getCurrentBufferNo: true });
        audioWorkletNode.port.onmessage = (msg) => {
            if (msg.data.currentBufferNo !== undefined) {
                currentTimeSpan.innerHTML = bufferNoToTimeString(msg.data.currentBufferNo, audioContext.sampleRate);
                timeSlider.value = msg.data.currentBufferNo;
                setVisualizationTime(endOfSong * msg.data.currentBufferNo / endBufferNo);
            }

            requestAnimationFrame(() => messageLoop());
        };
    };
    messageLoop();

    timeSlider.addEventListener('input', () => {
        bufferno = audioWorkletNode.port.postMessage({ seek: parseInt(timeSlider.value) });
    });
}

async function togglePlay() {
    if (!initPromise) {
        initPromise = new Promise(async (resolve, reject) => {
            try {
                //await loadMusic(7, 10);
                await loadMusic(34, 43);
                viewListeningCredit();
                insertVisualizationObjects(visualizationObjects);
                await initPlay();
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }
    await initPromise;

    playing = !playing;
    audioWorkletNode.port.postMessage({ toggleSongPlay: playing });
}

window.togglePlay = async () => {
    await audioContext.resume();
    togglePlayButton.innerHTML = playing ? '&#9654;' : '&#9725;';

    if (playing) {
        infopanel.classList.remove('fadeout');
        infopanel.classList.add('fadein');
        infopanel.querySelectorAll('button').forEach(b => b.style.visibility = 'visible');
    } else {
        infopanel.querySelectorAll('button').forEach(b => b.style.visibility = 'hidden');
        infopanel.classList.remove('fadein');
        infopanel.classList.add('fadeout');
    }
    await togglePlay();
}

window.login = async () => {
    await walletConnection.requestSignIn(
        nearconfig.contractName,
        'wasm-music'
    );
    await loadAccountData();
}


(async () => {
    nearconfig.deps.keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();
    window.near = await nearApi.connect(nearconfig);
    window.walletConnection = new nearApi.WalletConnection(near);

    // Load in account data
    const loggedInUser = walletConnection.getAccountId();
    if (loggedInUser) {
        document.getElementById('username').innerHTML = loggedInUser;
        document.getElementById('userpanel').style.display = 'block';
        await viewListeningCredit();
    } else {
        document.getElementById('loginpanel').style.display = 'block';
    }
})();