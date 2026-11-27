import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/server';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { products } from '../../db/schema.js';
import catalog from '../../db/catalog.json' with { type: 'json' };

const seeds = new Map(catalog.map(product => [product.id, { ...product, o: null, cols: [] as string[] }]));
const maxPhotoBytes = 512 * 1024;
const maxPhotos = 4;
const photos = () => getStore({ name: 'catalog-photos', consistency: 'strong' });

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function requireAdmin(request: Request, context: Context) {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer [\w.-]+$/.test(authorization)) throw new RequestError(401, 'Sign in to manage products.');
  const identityUser = new URL('/.netlify/identity/user', context.site.url);
  identityUser.protocol = 'https:';
  const response = await fetch(identityUser, {
    headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401 || response.status === 403) throw new RequestError(401, 'Your session expired. Sign in again.');
  if (!response.ok) throw new RequestError(503, 'Sign-in verification is temporarily unavailable.');
  const user = await response.json();
  if (!Array.isArray(user.app_metadata?.roles) || !user.app_metadata.roles.includes('admin')) {
    throw new RequestError(403, 'This account does not have catalog admin access.');
  }
}

async function listProducts() {
  const result = new Map(seeds);
  const rows = await getDb().select().from(products);
  for (const { deleted, ...product } of rows) {
    if (deleted) result.delete(product.id);
    else result.set(product.id, product);
  }
  return [...result.values()].sort((left, right) => left.id - right.id);
}

function text(value: unknown, max: number, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()) || value.includes('\0')) {
    throw new RequestError(400, 'Check the required fields and their length limits.');
  }
  return value.trim();
}

async function readProduct(request: Request, existingImages: string[]) {
  if (Number(request.headers.get('content-length')) > maxPhotos * maxPhotoBytes + 32768) {
    throw new RequestError(413, 'The photos are too large. Choose smaller images.');
  }
  let form: FormData;
  let input;
  try {
    form = await request.formData();
    input = JSON.parse(String(form.get('product')));
    if (!input || typeof input !== 'object') throw new Error();
  } catch {
    throw new RequestError(400, 'The product could not be read.');
  }
  const n = text(input.n, 100), c = text(input.c, 50), d = text(input.d, 1500, false);
  const { p, o } = input;
  if (!Number.isInteger(p) || p < 1 || p > 100000000 || (o !== null && (!Number.isInteger(o) || o <= p || o > 100000000))) {
    throw new RequestError(400, 'Enter a positive whole-naira price. The previous price must be higher.');
  }
  if (!Array.isArray(input.cols) || input.cols.length > 12) throw new RequestError(400, 'Choose up to 12 colours.');
  const colours: string[] = input.cols.map((value: unknown) => text(value, 30));
  if (colours.some(value => /[|\x00-\x1f\x7f]/.test(value)) || new Set(colours.map(value => value.toLowerCase())).size !== colours.length) {
    throw new RequestError(400, 'Use distinct colour names without vertical bars or control characters.');
  }
  const images = input.imgs;
  const files = form.getAll('photo');
  if (!Array.isArray(images) || !images.every(path => existingImages.includes(path)) || new Set(images).size !== images.length ||
      images.length + files.length < 1 || images.length + files.length > maxPhotos) {
    throw new RequestError(400, 'Keep or upload between one and four product photos.');
  }
  for (const file of files) {
    if (!(file instanceof File) || file.type !== 'image/jpeg' || file.size < 5 || file.size > maxPhotoBytes) {
      throw new RequestError(400, 'Choose JPEG product photos up to 512 KB each.');
    }
    const signature = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (signature[0] !== 255 || signature[1] !== 216 || signature[2] !== 255) throw new RequestError(400, 'One of the photos is not a valid JPEG.');
  }
  return { product: { n, c, d, p, o, cols: colours, imgs: images as string[] }, files: files as File[] };
}

async function saveProduct(request: Request, id?: number) {
  const db = getDb();
  const seed = id === undefined ? undefined : seeds.get(id);
  const [stored] = id === undefined ? [] : await db.select().from(products).where(eq(products.id, id));
  if (id !== undefined && (stored?.deleted || (!stored && !seed))) throw new RequestError(404, 'This product no longer exists.');
  const { product, files } = await readProduct(request, stored?.imgs ?? seed?.imgs ?? []);
  const added: string[] = [];
  try {
    for (const file of files) {
      const key = `${randomUUID()}.jpg`;
      await photos().set(key, file);
      added.push(key);
      product.imgs.push(`/api/catalog/photos/${key}`);
    }
    const [saved] = id === undefined
      ? await db.insert(products).values(product).returning({ id: products.id })
      : seed
        ? await db.insert(products).values({ ...product, id }).onConflictDoUpdate({
          target: products.id, set: product, setWhere: eq(products.deleted, false),
        }).returning({ id: products.id })
        : await db.update(products).set(product).where(eq(products.id, id)).returning({ id: products.id });
    if (!saved) throw new RequestError(404, 'This product no longer exists.');
    return json({ ...product, id: saved.id }, id === undefined ? 201 : 200);
  } catch (error) {
    await Promise.allSettled(added.map(key => photos().delete(key)));
    throw error;
  }
}

async function deleteProduct(id: number) {
  const db = getDb();
  const seed = seeds.get(id);
  if (seed) {
    await db.insert(products).values({ ...seed, imgs: [], deleted: true })
      .onConflictDoUpdate({ target: products.id, set: { deleted: true, imgs: [] } });
  } else {
    const [removed] = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    if (!removed) throw new RequestError(404, 'This product no longer exists.');
  }
  return new Response(null, { status: 204 });
}

export default async function handler(request: Request, context: Context) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  try {
    if (method === 'GET' && path === '/api/catalog/products') return json(await listProducts());
    const photo = /^\/api\/catalog\/photos\/([a-f0-9-]{36}\.jpg)$/.exec(path);
    if (method === 'GET' && photo) {
      const image = await photos().get(photo[1], { type: 'stream' });
      if (!image) throw new RequestError(404, 'Photo not found.');
      return new Response(image, { headers: {
        'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable',
      } });
    }
    const match = /^\/api\/catalog\/products\/(\d{1,10})$/.exec(path);
    if (method === 'GET' && path === '/api/catalog/session') {
      await requireAdmin(request, context);
      return json({ admin: true });
    }
    if (method === 'POST' && path === '/api/catalog/products') {
      await requireAdmin(request, context);
      return await saveProduct(request);
    }
    if (match && (method === 'PUT' || method === 'DELETE')) {
      await requireAdmin(request, context);
      const id = Number(match[1]);
      if (id > 2147483647) throw new RequestError(404, 'Product not found.');
      return method === 'PUT' ? await saveProduct(request, id) : await deleteProduct(id);
    }
    throw new RequestError(404, 'Not found.');
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error('Catalog operation failed', { method, error: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'The catalog is temporarily unavailable. Try again shortly.' }, 503);
  }
}
