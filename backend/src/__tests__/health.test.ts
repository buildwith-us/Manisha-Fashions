import { clearTestDb, connectTestDb, disconnectTestDb, request } from './helpers/testServer';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(clearTestDb);

describe('GET /health (Render health check path)', () => {
  it('answers outside the API prefix with the database state', async () => {
    const res = await request.get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: true });
  });

  it('is not rate limited, so health probes never spend a customer budget', async () => {
    const res = await request.get('/health');
    expect(res.headers).not.toHaveProperty('ratelimit');
  });
});
