import {
  api,
  clearTestDb,
  connectTestDb,
  createTestUser,
  disconnectTestDb,
  request,
} from './helpers/testServer';
import { CodStateConfig } from '../models/codStateConfig.model';

/**
 * Admin CRUD over the per-state COD rules (PRD 4.4 / 6), and the role boundary
 * around it: this decides what a customer is charged, so staff cannot reach it.
 */

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(clearTestDb);

describe('GET /admin/cod-config', () => {
  it('lists every state with the store default until one is configured', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    const response = await request
      .get(api('/admin/cod-config'))
      .set('Authorization', admin.auth)
      .expect(200);

    const { defaults, configured, states } = response.body.data;

    expect(defaults).toEqual({ codEnabled: true, codCharge: 5000 });
    expect(configured).toEqual([]);
    // 28 states + 8 union territories.
    expect(states).toHaveLength(36);

    const kerala = states.find((entry: { state: string }) => entry.state === 'Kerala');
    expect(kerala).toMatchObject({ codEnabled: true, codCharge: 5000, configured: false });
  });

  it('reports a configured state as set, leaving the rest on the default', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .put(api('/admin/cod-config/Tamil%20Nadu'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: true, codCharge: 12_000 })
      .expect(200);

    const response = await request
      .get(api('/admin/cod-config'))
      .set('Authorization', admin.auth)
      .expect(200);

    const { configured, states } = response.body.data;
    expect(configured).toHaveLength(1);
    expect(configured[0]).toMatchObject({ state: 'Tamil Nadu', codCharge: 12_000 });

    const tamilNadu = states.find((entry: { state: string }) => entry.state === 'Tamil Nadu');
    expect(tamilNadu).toMatchObject({ codCharge: 12_000, configured: true });

    const kerala = states.find((entry: { state: string }) => entry.state === 'Kerala');
    expect(kerala).toMatchObject({ codCharge: 5000, configured: false });
  });
});

describe('PUT /admin/cod-config/:state', () => {
  it('creates a rule, then replaces it in place rather than adding a second', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .put(api('/admin/cod-config/Karnataka'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: true, codCharge: 7500 })
      .expect(200);

    const updated = await request
      .put(api('/admin/cod-config/Karnataka'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: false, codCharge: 7500 })
      .expect(200);

    expect(updated.body.data).toMatchObject({ state: 'Karnataka', codEnabled: false });
    await expect(CodStateConfig.countDocuments()).resolves.toBe(1);
  });

  it('folds case and spacing onto one row, so a differently typed state still matches', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .put(api('/admin/cod-config/Tamil%20Nadu'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: true, codCharge: 9000 })
      .expect(200);

    await request
      .put(api('/admin/cod-config/tamil%20%20nadu'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: true, codCharge: 11_000 })
      .expect(200);

    await expect(CodStateConfig.countDocuments()).resolves.toBe(1);
    const row = await CodStateConfig.findOne();
    expect(row?.codCharge).toBe(11_000);
  });

  it('rejects a charge that is not whole paise', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .put(api('/admin/cod-config/Goa'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: true, codCharge: 150.5 })
      .expect(422);
  });

  it('rejects a negative charge', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .put(api('/admin/cod-config/Goa'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: true, codCharge: -100 })
      .expect(422);
  });
});

describe('DELETE /admin/cod-config/:state', () => {
  it('removes the override so the state falls back to the default', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .put(api('/admin/cod-config/Punjab'))
      .set('Authorization', admin.auth)
      .send({ codEnabled: false, codCharge: 0 })
      .expect(200);

    const response = await request
      .delete(api('/admin/cod-config/Punjab'))
      .set('Authorization', admin.auth)
      .expect(200);

    expect(response.body.data).toMatchObject({ codEnabled: true, codCharge: 5000 });
    await expect(CodStateConfig.countDocuments()).resolves.toBe(0);
  });

  it('404s when the state has no override to remove', async () => {
    const admin = await createTestUser({ accountType: 'admin' });

    await request
      .delete(api('/admin/cod-config/Punjab'))
      .set('Authorization', admin.auth)
      .expect(404);
  });
});

describe('access control', () => {
  it('refuses staff — COD pricing sits with admin (PRD 8.9)', async () => {
    const staff = await createTestUser({ accountType: 'staff' });

    await request.get(api('/admin/cod-config')).set('Authorization', staff.auth).expect(403);

    await request
      .put(api('/admin/cod-config/Kerala'))
      .set('Authorization', staff.auth)
      .send({ codEnabled: false, codCharge: 0 })
      .expect(403);

    await expect(CodStateConfig.countDocuments()).resolves.toBe(0);
  });

  it('refuses an ordinary customer', async () => {
    const customer = await createTestUser();

    await request
      .put(api('/admin/cod-config/Kerala'))
      .set('Authorization', customer.auth)
      .send({ codEnabled: true, codCharge: 0 })
      .expect(403);
  });

  it('refuses an unauthenticated caller', async () => {
    await request.get(api('/admin/cod-config')).expect(401);
  });
});
