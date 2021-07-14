const SAMPLE_FRAMES = 128;

class EventListAndWasmSynthAudioWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.processorActive = true;
        this.playSong = true;
        this.bufferNo = 0;

        this.port.onmessage = async (msg) => {
            if (msg.data.wasm) {
                this.wasmInstancePromise = WebAssembly.instantiate(msg.data.wasm,
                    {
                        environment: {
                            SAMPLERATE: sampleRate || AudioWorkletGlobalScope.sampleRate
                        }
                    });
                this.wasmInstance = (await this.wasmInstancePromise).instance.exports;
                this.leftbuffer = new Float32Array(this.wasmInstance.memory.buffer,
                    this.wasmInstance.samplebuffer,
                    SAMPLE_FRAMES);
                this.rightbuffer = new Float32Array(this.wasmInstance.memory.buffer,
                    this.wasmInstance.samplebuffer + (SAMPLE_FRAMES * 4),
                    SAMPLE_FRAMES);
                this.eventlist = msg.data.eventlist;
                this.endBufferNo = msg.data.endBufferNo;
            }

            if (msg.data.getCurrentBufferNo) {
                this.port.postMessage({
                    currentBufferNo: this.bufferNo
                });
            }

            if (msg.data.toggleSongPlay !== undefined) {
                if (msg.data.toggleSongPlay === false) {
                    this.allNotesOff();
                    this.playSong = false;
                } else {
                    this.playSong = true;
                }
            }

            if (msg.data.seek !== undefined) {
                this.allNotesOff();
                this.bufferNo = msg.data.seek;
            }

            if (msg.data.terminate) {
                this.processorActive = false;
                this.port.close();
            }
        };
    }

    allNotesOff() {
        if (this.wasmInstance) {
            this.wasmInstance.allNotesOff();
            for (let ch = 0; ch < 16; ch++) {
                this.wasmInstance.shortmessage(
                    0xb0 + ch, 64, 0  // reset sustain pedal
                );
            }
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];

        if (this.wasmInstance) {
            if (this.playSong) {
                const events = this.eventlist[this.bufferNo];
                if (events) {
                    for (let n = 0; n < events.length; n++) {
                        const evt = events[n];
                        this.wasmInstance.shortmessage(evt[0], evt[1], evt[2])
                    }
                }
                this.bufferNo++;
                if (this.bufferNo === this.endBufferNo) {
                    this.bufferNo = 0;
                }
            }
            this.wasmInstance.fillSampleBuffer();

            output[0].set(this.leftbuffer);
            output[1].set(this.rightbuffer);
        }

        return this.processorActive;
    }
}

registerProcessor('eventlist-and-wasmsynth-audio-worklet-processor', EventListAndWasmSynthAudioWorkletProcessor);
