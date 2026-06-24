import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { extractQuotaEntries, parseLanguageServerProcessList, postLocalJson } from './localLanguageServerClient';

jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));

describe('localLanguageServerClient', () => {
  it('extracts quota entries from the GetUserStatus userStatus wrapper', () => {
    const entries = extractQuotaEntries({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: 'Gemini 3 Flash',
              modelOrAlias: { model: 'gemini-flash' },
              quotaInfo: { remainingFraction: 0.84, resetTime: '2026-06-01T04:45:00.000Z' }
            }
          ]
        }
      }
    });

    expect(entries).toEqual([
      {
        label: 'Gemini 3 Flash',
        modelId: 'gemini-flash',
        remainingFraction: 0.84,
        resetTime: new Date('2026-06-01T04:45:00.000Z')
      }
    ]);
  });

  it('extracts quota entries from GetUserStatus model configs', () => {
    const entries = extractQuotaEntries({
      cascadeModelConfigData: {
        clientModelConfigs: [
          {
            label: 'Gemini 3 Flash',
            modelOrAlias: { model: 'gemini-flash' },
            quotaInfo: { remainingFraction: 0.84, resetTime: '2026-06-01T04:45:00.000Z' }
          },
          {
            label: 'Claude Sonnet 4.6',
            modelOrAlias: { model: 'claude-sonnet' },
            quotaInfo: { remainingFraction: 0.91, resetTime: '2026-06-04T18:00:00.000Z' }
          },
          {
            label: 'Disabled',
            disabled: true,
            quotaInfo: { remainingFraction: 0.1, resetTime: '2026-06-01T04:45:00.000Z' }
          }
        ]
      }
    });

    expect(entries).toEqual([
      {
        label: 'Gemini 3 Flash',
        modelId: 'gemini-flash',
        remainingFraction: 0.84,
        resetTime: new Date('2026-06-01T04:45:00.000Z')
      },
      {
        label: 'Claude Sonnet 4.6',
        modelId: 'claude-sonnet',
        remainingFraction: 0.91,
        resetTime: new Date('2026-06-04T18:00:00.000Z')
      }
    ]);
  });

  it('accepts snake_case fields returned by Connect JSON transcoding', () => {
    const entries = extractQuotaEntries({
      cascade_model_config_data: {
        client_model_configs: [
          {
            label: 'GPT-OSS 120B',
            model_or_alias: { model: 'gpt-oss-120b' },
            quota_info: { remaining_fraction: 0.97, reset_time: '2026-06-04T18:00:00.000Z' }
          }
        ]
      }
    });

    expect(entries[0]).toMatchObject({
      label: 'GPT-OSS 120B',
      modelId: 'gpt-oss-120b',
      remainingFraction: 0.97,
      resetTime: new Date('2026-06-04T18:00:00.000Z')
    });
  });

  it('accepts protobuf timestamp objects for resetTime', () => {
    const entries = extractQuotaEntries({
      cascadeModelConfigData: {
        clientModelConfigs: [
          {
            label: 'Gemini 3.1 Pro Low',
            modelOrAlias: { model: 'gemini-pro-low' },
            quotaInfo: {
              remainingFraction: 0.89,
              resetTime: { seconds: 1780596000, nanos: 123000000 }
            }
          }
        ]
      }
    });

    expect(entries[0]).toMatchObject({
      label: 'Gemini 3.1 Pro Low',
      modelId: 'gemini-pro-low',
      remainingFraction: 0.89,
      resetTime: new Date('2026-06-04T18:00:00.123Z')
    });
  });
});

describe('parseLanguageServerProcessList', () => {
  it('detects Antigravity language server args with app_data_dir value', () => {
    const processes = parseLanguageServerProcessList([
      ' 101 1 /bin/language_server --extension_server_port 53125 --csrf_token abc-123 --app_data_dir antigravity',
      ' 102 1 /bin/language_server --extension_server_port 53126 --csrf_token wrong --app_data_dir codeium',
      ' 103 1 /bin/other --csrf_token abc-456'
    ].join('\n'));

    expect(processes).toEqual([
      {
        pid: 101,
        ppid: 1,
        extensionPort: 53125,
        csrfToken: 'abc-123'
      }
    ]);
  });

  it('detects Antigravity language server args with app_data_dir path and sorts child process first', () => {
    const processes = parseLanguageServerProcessList([
      ' 201 1 /bin/language_server --extension_server_port=53125 --csrf_token=older --app_data_dir=/Users/me/Library/Application Support/antigravity',
      ' 202 999 /bin/language_server --extension_server_port=53126 --csrf_token=current --app_data_dir=/Users/me/Library/Application Support/Antigravity'
    ].join('\n'), 999);

    expect(processes.map((process) => process.pid)).toEqual([202, 201]);
    expect(processes.map((process) => process.extensionPort)).toEqual([53126, 53125]);
  });
});

describe('postLocalJson', () => {
  it('falls back to HTTP when the local language server does not speak HTTPS', async () => {
    const httpsRequest = https.request as jest.Mock;
    httpsRequest.mockImplementation(() => {
      const req = new EventEmitter() as http.ClientRequest;
      req.setTimeout = jest.fn() as unknown as http.ClientRequest['setTimeout'];
      req.write = jest.fn() as unknown as http.ClientRequest['write'];
      req.end = jest.fn(() => {
        process.nextTick(() => req.emit('error', new Error('wrong version number')));
        return req;
      }) as unknown as http.ClientRequest['end'];
      return req;
    });

    let receivedBody = '';
    let receivedCsrf = '';
    const httpRequest = http.request as jest.Mock;
    httpRequest.mockImplementation((options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
      const headers = (options.headers ?? {}) as Record<string, string | number | string[]>;
      receivedCsrf = String(headers['X-Codeium-Csrf-Token'] ?? '');
      const req = new EventEmitter() as http.ClientRequest;
      req.setTimeout = jest.fn() as unknown as http.ClientRequest['setTimeout'];
      req.write = jest.fn((chunk: string) => {
        receivedBody += chunk;
        return true;
      }) as unknown as http.ClientRequest['write'];
      req.end = jest.fn(() => {
        const res = new EventEmitter() as http.IncomingMessage;
        res.statusCode = 200;
        process.nextTick(() => {
          callback?.(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true })));
          res.emit('end');
        });
        return req;
      }) as unknown as http.ClientRequest['end'];
      return req;
    });

    try {
      const response = await postLocalJson<{ ok: boolean }>(
        { pid: 123, port: 53125, csrfToken: 'csrf-123' },
        '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        { metadata: { ideName: 'antigravity' } }
      );

      expect(response).toEqual({ ok: true });
      expect(receivedCsrf).toBe('csrf-123');
      expect(JSON.parse(receivedBody)).toEqual({ metadata: { ideName: 'antigravity' } });
      expect(httpsRequest).toHaveBeenCalledTimes(1);
      expect(httpRequest).toHaveBeenCalledTimes(1);
    } finally {
      httpsRequest.mockReset();
      httpRequest.mockReset();
    }
  });
});
