/**
 * Notes API smoke tests — validates auth rejection + basic endpoint availability.
 * Dynamic import to avoid module-level config validation crash in CI.
 */
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('Notes API — auth rejection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/notes/export rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notes/export?format=json',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/notes/:noteId rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notes/some-note-id',
    });

    expect(response.statusCode).toBe(401);
  });

  it('PATCH /api/v1/notes/:noteId rejects without auth', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notes/some-note-id',
      payload: { content: 'updated content' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('DELETE /api/v1/notes/:noteId rejects without auth', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/notes/some-note-id',
    });

    expect(response.statusCode).toBe(401);
  });
});

describeIfServer('Notes API — video notes auth rejection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/notes/videos/:id/notes rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notes/videos/some-video-id/notes',
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/notes/videos/:id/notes rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/notes/videos/some-video-id/notes',
      payload: { timestamp: 0, content: 'test note' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describeIfServer('Quota API — auth rejection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/quota/usage rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/quota/usage',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/quota/limits rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/quota/limits',
    });

    expect(response.statusCode).toBe(401);
  });
});

describeIfServer('Subscriptions API — auth rejection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/subscriptions/updates rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subscriptions/updates',
    });

    expect(response.statusCode).toBe(401);
  });
});

describeIfServer('Ontology API — auth rejection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/ontology/nodes rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ontology/nodes',
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/ontology/nodes rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ontology/nodes',
      payload: { type: 'topic', name: 'test', domain: 'service' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/ontology/edges rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ontology/edges',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/ontology/stats rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ontology/stats',
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/ontology/chat rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ontology/chat',
      payload: { message: 'hello' },
    });

    expect(response.statusCode).toBe(401);
  });
});
