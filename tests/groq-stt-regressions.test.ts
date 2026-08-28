import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getVettedPublicAddress,
  isPrivateIpAddress,
  offsetTranscriptionPart,
  safeDownloadResponse,
  validateExactChunkDurations,
  type GroqTranscriptionResult,
} from '../lib/groq-stt';

test('rejects loopback, private and link-local addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    'fe80::1',
  ]) {
    assert.equal(isPrivateIpAddress(address), true, address);
    await assert.rejects(
      getVettedPublicAddress('https://media.example/file.mp4', async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]),
      /privada|não permitida/,
    );
  }
});

test('rejects a redirect whose destination resolves to a private address', async () => {
  await assert.rejects(
    safeDownloadResponse('https://public.example/start', 1024, {
      resolveAddresses: async (hostname) => [
        {
          address: hostname === 'public.example' ? '203.0.113.10' : '127.0.0.1',
          family: 4,
        },
      ],
      request: async () => ({
        status: 302,
        headers: { location: 'http://internal.example/private' },
      }),
    }),
    /privada|não permitida/,
  );
});

test('pins each public redirect connection to its vetted DNS answer', async () => {
  const connectedAddresses: string[] = [];
  let requestCount = 0;
  const response = await safeDownloadResponse('https://one.example/start', 1024, {
    resolveAddresses: async (hostname) => [
      { address: hostname === 'one.example' ? '203.0.113.10' : '198.51.100.20', family: 4 },
    ],
    request: async (_url, config) => {
      const lookup = config.lookup as Function;
      lookup('ignored.example', {}, (_error: Error | null, address: string) => {
        connectedAddresses.push(address);
      });
      requestCount += 1;
      return requestCount === 1
        ? { status: 302, headers: { location: 'https://two.example/media.mp3' } }
        : { status: 200, headers: {}, data: Buffer.from('audio') };
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(connectedAddresses, ['203.0.113.10', '198.51.100.20']);
});

test('a DNS answer changing after validation cannot change the pinned connection', async () => {
  let dnsCalls = 0;
  let connectedAddress = '';
  await safeDownloadResponse('https://rebind.example/media.mp3', 1024, {
    resolveAddresses: async () => {
      dnsCalls += 1;
      return [{ address: dnsCalls === 1 ? '203.0.113.30' : '127.0.0.1', family: 4 }];
    },
    request: async (_url, config) => {
      (config.lookup as Function)(
        'rebind.example',
        {},
        (_error: Error | null, address: string) => {
          connectedAddress = address;
        },
      );
      return { status: 200, headers: {}, data: Buffer.from('audio') };
    },
  });

  assert.equal(dnsCalls, 1);
  assert.equal(connectedAddress, '203.0.113.30');
});

test('keeps timestamps continuous through a short final part', () => {
  const fixture = (start: number, end: number, text: string): GroqTranscriptionResult => ({
    text,
    rawText: text,
    segments: [{ id: 0, start, end, text, part: 1 }],
    duration: end,
    partCount: 1,
  });
  const first = offsetTranscriptionPart(fixture(0, 420, 'primeira'), 0, 1, 0);
  const final = offsetTranscriptionPart(fixture(0, 12.5, 'final'), 420, 2, 1);

  assert.equal(first.segments[0].end, 420);
  assert.equal(final.segments[0].start, 420);
  assert.equal(final.segments[0].end, 432.5);
  assert.equal(final.segments[0].part, 2);
});

test('aborts when any chunk duration cannot be measured exactly', () => {
  assert.throws(
    () => validateExactChunkDurations([420, 0, 12.5], ['chunk_0.mp3', 'chunk_1.mp3', 'chunk_2.mp3']),
    /chunk_1\.mp3.*minutagens incorretas/,
  );
});