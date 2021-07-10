const nearconfig = {
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://wallet.mainnet.near.org',
    helperUrl: 'https://helper.mainnet.near.org',
    networkId: 'mainnet',
    contractName: 'psalomo.near',
    deps: {
        keyStore: null
    }
};

nearconfig.deps.keyStore = new nearApi.keyStores.BrowserLocalStorageKeyStore();

const wasmbuffersize = 128;
const SERIALIZE_TIME_RESOLUTION = 8;
const COLUMNS_PER_BEAT = 8;
let bpm;
let wasm_bytes;
let eventlist;
let walletConnection;
let endBufferNo;

async function getTokenContent(token_id) {
    const near = await nearApi.connect(nearconfig);
    walletConnection = new nearApi.WalletConnection(near);

    const result = await walletConnection.account()
        .viewFunction(nearconfig.contractName, 'view_token_content_base64', { token_id: token_id });
    return result;
}

async function getRemixTokenContent(id) {
    return await walletConnection.account().viewFunction(nearconfig.contractName, 'view_remix_content', { token_id: id });
}

function base64ToByteArray(base64encoded) {
    return ((str) => new Uint8Array(str.length).map((v, n) => str.charCodeAt(n)))(atob(base64encoded));
}

async function loadMusic(tokenId, remimxTokenId, sampleRate) {
    wasm_bytes = pako.ungzip(base64ToByteArray((await getTokenContent(tokenId + '')).replaceAll(/\"/g, '')));
    eventlist = {};

    const mixtokendata = await getRemixTokenContent(remimxTokenId + '');
    let musicdata = pako.ungzip(base64ToByteArray(mixtokendata.split(';')[3]));
    numparts = musicdata[0];

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
            events: []
        };

        while (n < controllersndx) {
            const evtstart = musicdata[n++] / SERIALIZE_TIME_RESOLUTION;
            const duration = musicdata[n++] / SERIALIZE_TIME_RESOLUTION;
            const noteNumber = musicdata[n++];
            const velocityValue = musicdata[n++];
            parts[partno].events.push({pos: evtstart, message: [0x90 + channel, noteNumber, velocityValue]});
            parts[partno].events.push({pos: evtstart + duration, message: [0x90 + channel, noteNumber, 0]});
        }
        while (n < nextchannelndx) {
            const evtstart = musicdata[n++] / SERIALIZE_TIME_RESOLUTION;
            const controllerNumber = musicdata[n++];
            const controllerValue = musicdata[n++];
            parts[partno].events.push({pos: evtstart, message: [0xb0 + channel, controllerNumber, controllerValue]});
        }
    }

    const mixerdatapos = n;

    bpm = musicdata[mixerdatapos + 32];
    const beatposToBufferNo = (pos) => Math.round((pos * 60 / bpm) * sampleRate / wasmbuffersize);
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

    let endOfSong = 0;
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
        }
    });

    endBufferNo = beatposToBufferNo(endOfSong);
}

async function playMusic(ctx, analyzer) {
    wasm = (await WebAssembly.instantiate(wasm_bytes, { environment: { SAMPLERATE: ctx.sampleRate } })).instance.exports;

    const numbuffers = 50;
    let bufferno = 0;
    const chunkInterval = wasmbuffersize * numbuffers / ctx.sampleRate;
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
    if (analyzer) {
        analyzer.setInput(gainNode);
    }
    let chunkStartTime = ctx.currentTime + 0.2;

    while (true) {
        const processorBuffer = ctx.createBuffer(2, wasmbuffersize * numbuffers, ctx.sampleRate);
        for (let n = 0; n < numbuffers; n++) {
            eventlist[bufferno++]?.forEach(evt => wasm.shortmessage(evt[0], evt[1], evt[2]));

            if (bufferno === endBufferNo) {
                bufferno = 0;
            }
            wasm.fillSampleBuffer();
            processorBuffer.getChannelData(0).set(new Float32Array(wasm.memory.buffer,
                wasm.samplebuffer,
                wasmbuffersize), wasmbuffersize * n);
            processorBuffer.getChannelData(1).set(new Float32Array(wasm.memory.buffer,
                wasm.samplebuffer + (wasmbuffersize * 4),
                wasmbuffersize), wasmbuffersize * n);
        }
        const bufferSource = ctx.createBufferSource();
        bufferSource.buffer = processorBuffer;
        bufferSource.connect(gainNode);
        bufferSource.start(chunkStartTime);
        chunkStartTime += chunkInterval;

        await new Promise((r) => setTimeout(r, chunkInterval));
    }
}