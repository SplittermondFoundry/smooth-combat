import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44_100;
const NOTE_LENGTH = 0.2;
const profiles = {
    shield: { wave: "sine", notes: [[330, 0], [494, 0.08], [659, 0.16]] },
    impact: { wave: "triangle", notes: [[180, 0], [125, 0.1]] },
    blocked: { wave: "square", notes: [[740, 0], [520, 0.055], [370, 0.11]] },
    arcane: { wave: "sine", notes: [[523, 0], [659, 0.07], [784, 0.14]] },
    shot: { wave: "sine", notes: [[880, 0], [440, 0.06]] },
    turn: { wave: "sine", notes: [[440, 0], [660, 0.11], [880, 0.22]] },
};

function waveform(type, phase) {
    const cycle = phase / (Math.PI * 2);
    if (type === "square") return Math.sin(phase) >= 0 ? 1 : -1;
    if (type === "triangle") return 2 * Math.abs(2 * (cycle - Math.floor(cycle + 0.5))) - 1;
    return Math.sin(phase);
}

function synthesize({ wave, notes }) {
    const duration = Math.max(...notes.map(([, delay]) => delay + NOTE_LENGTH)) + 0.025;
    const samples = new Float64Array(Math.ceil(duration * SAMPLE_RATE));
    for (const [frequency, delay] of notes) {
        const start = Math.floor(delay * SAMPLE_RATE);
        const length = Math.ceil(NOTE_LENGTH * SAMPLE_RATE);
        for (let offset = 0; offset < length && start + offset < samples.length; offset += 1) {
            const time = offset / SAMPLE_RATE;
            const progress = time / NOTE_LENGTH;
            const attack = Math.min(1, time / 0.012);
            const release = Math.max(0, 1 - progress) ** 2.2;
            samples[start + offset] += waveform(wave, Math.PI * 2 * frequency * time) * attack * release * 0.24;
        }
    }
    const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0) || 1;
    const scale = Math.min(1, 0.82 / peak);
    return Int16Array.from(samples, (sample) => Math.round(sample * scale * 0x7fff));
}

function wavBuffer(samples) {
    const bytesPerSample = 2;
    const dataLength = samples.length * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataLength);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
    buffer.writeUInt16LE(bytesPerSample, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLength, 40);
    for (let index = 0; index < samples.length; index += 1) {
        buffer.writeInt16LE(samples[index], 44 + index * bytesPerSample);
    }
    return buffer;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "Modul", "splittermond-smoother-fight", "assets", "audio");
fs.mkdirSync(outputDirectory, { recursive: true });
for (const [id, profile] of Object.entries(profiles)) {
    fs.writeFileSync(path.join(outputDirectory, `${id}.wav`), wavBuffer(synthesize(profile)));
}
