import { acceptInvite, getUser, handleAuthCallback, login, logout, refreshSession } from '@netlify/identity';

const byId = id => document.getElementById(id);
const endpoint = '/api/catalog/products';
const signIn = byId('sign-in');
const editor = byId('editor');
const productForm = byId('product-form');
const deleteDialog = byId('delete-dialog');
const priceFormat = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
const palette = new Map(Object.entries({ Black: '#211f21', White: '#fff', Silver: '#aeb4bc', Gold: '#d6a638', 'Rose Gold': '#cb948d', Brown: '#6f4435', Blue: '#285cb4', Green: '#37784a', Red: '#bb241b', Pink: '#e787ae' }));
let products = [];
let inviteToken = null;
let editing = null;
let deleting = null;
let colourOptions = [];
let selected = new Set();
let photos = [];

function message(id, text) {
  const element = byId(id);
  element.textContent = text;
  element.hidden = !text;
}

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function button(text, action, className = 'quiet') {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

async function api(path, options = {}, protectedRoute = false) {
  const headers = new Headers(options.headers);
  if (protectedRoute) {
    await refreshSession();
    const token = document.cookie.match(/(?:^|;\s*)nf_jwt=([^;]+)/)?.[1];
    if (token) headers.set('Authorization', `Bearer ${decodeURIComponent(token)}`);
  }
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.error || 'The catalog could not be reached. Try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function showSignIn(error = '') {
  byId('auth').hidden = false;
  byId('dashboard').hidden = true;
  signIn.hidden = false;
  byId('email-field').hidden = Boolean(inviteToken);
  signIn.elements.email.required = !inviteToken;
  signIn.elements.password.autocomplete = inviteToken ? 'new-password' : 'current-password';
  signIn.elements.password.minLength = inviteToken ? 8 : 0;
  byId('sign-in-button').textContent = inviteToken ? 'Set password' : 'Sign in';
  byId('auth-hint').textContent = inviteToken ? 'Set a password to accept your admin invitation.' : 'Sign in with an invited Glockhub Store admin account.';
  message('auth-error', error);
}

async function showDashboard() {
  await api('/api/catalog/session', {}, true);
  byId('auth').hidden = true;
  byId('dashboard').hidden = false;
  await loadProducts();
}

async function init() {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === 'invite') {
      inviteToken = callback.token;
      showSignIn();
    } else if (await getUser()) {
      await showDashboard();
    } else {
      showSignIn();
    }
  } catch (error) {
    showSignIn(error.message);
  }
}

signIn.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = byId('sign-in-button');
  submit.disabled = true;
  message('auth-error', '');
  try {
    if (inviteToken) {
      await acceptInvite(inviteToken, signIn.elements.password.value);
      inviteToken = null;
    } else {
      await login(signIn.elements.email.value.trim(), signIn.elements.password.value);
    }
    await showDashboard();
  } catch (error) {
    showSignIn(error.status === 400 ? 'Check your sign-in details and try again.' : error.message);
  } finally {
    signIn.elements.password.value = '';
    submit.disabled = false;
  }
});

byId('sign-out').addEventListener('click', async () => {
  byId('sign-out').disabled = true;
  await logout().catch(() => {});
  byId('sign-out').disabled = false;
  showSignIn();
});

function drawList() {
  const query = byId('search').value.trim().toLowerCase();
  const visible = products.filter(product => `${product.n} ${product.c} ${(product.cols || []).join(' ')}`.toLowerCase().includes(query));
  const list = byId('product-list');
  list.replaceChildren();
  const count = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
  byId('catalog-count').textContent = query ? `${visible.length} of ${count}` : `${count} in the storefront`;
  for (const product of visible) {
    const row = element('tr');
    const item = element('div', '', 'item');
    const img = element('img');
    img.src = product.imgs[0];
    img.alt = '';
    img.loading = 'lazy';
    item.append(img, element('span', product.n));
    row.insertCell().append(item);
    row.insertCell().textContent = product.c;
    row.insertCell().textContent = priceFormat.format(product.p);
    row.insertCell().textContent = product.cols?.join(', ') || '—';
    const actions = row.insertCell();
    actions.className = 'action-cell';
    const edit = button('Edit', () => startEditor(product));
    edit.setAttribute('aria-label', `Edit ${product.n}`);
    const remove = button('Delete', () => startDelete(product), 'quiet danger');
    remove.setAttribute('aria-label', `Delete ${product.n}`);
    actions.append(edit, remove);
    list.append(row);
  }
  byId('table-wrap').hidden = !visible.length;
  message('catalog-state', visible.length ? '' : query ? 'No products match your search.' : 'No products yet. Add your first product to get started.');
}

async function loadProducts() {
  byId('new-product').disabled = true;
  byId('retry').hidden = true;
  byId('table-wrap').hidden = true;
  message('catalog-state', 'Loading products…');
  try {
    products = await api(endpoint);
    drawList();
    byId('new-product').disabled = false;
  } catch (error) {
    message('catalog-state', error.message);
    byId('retry').hidden = false;
  }
}

byId('search').addEventListener('input', () => { if (!byId('new-product').disabled) drawList(); });
byId('retry').addEventListener('click', loadProducts);
byId('new-product').addEventListener('click', () => startEditor(null));

function drawColours() {
  const chooser = byId('palette');
  chooser.replaceChildren();
  for (const colour of colourOptions) {
    const choice = button('', () => {
      if (selected.has(colour)) selected.delete(colour);
      else if (selected.size < 12) selected.add(colour);
      else return message('editor-error', 'Select up to 12 colours.');
      message('editor-error', '');
      choice.setAttribute('aria-pressed', selected.has(colour));
    }, 'colour');
    const swatch = element('span', '', 'swatch');
    swatch.style.backgroundColor = palette.get(colour) || '#e9e2dc';
    swatch.setAttribute('aria-hidden', 'true');
    choice.append(swatch, document.createTextNode(colour));
    choice.setAttribute('aria-pressed', selected.has(colour));
    chooser.append(choice);
  }
}

function addColour() {
  const input = byId('custom-colour');
  const name = input.value.trim();
  if (!name || /[|\x00-\x1f\x7f]/.test(name)) return message('editor-error', 'Enter a colour name without a vertical bar.');
  const existing = colourOptions.find(colour => colour.toLowerCase() === name.toLowerCase());
  if (selected.size >= 12 && !selected.has(existing)) return message('editor-error', 'Select up to 12 colours.');
  if (!existing) colourOptions.push(name);
  selected.add(existing || name);
  message('editor-error', '');
  input.value = '';
  drawColours();
  input.focus();
}

byId('add-colour').addEventListener('click', addColour);
byId('custom-colour').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); addColour(); }
});

function drawPhotos() {
  const list = byId('photo-list');
  list.replaceChildren();
  photos.forEach((photo, index) => {
    const tile = element('div', '', 'photo');
    const image = element('img');
    image.src = photo.url;
    image.alt = `Product photo ${index + 1}`;
    const remove = button('Remove', () => {
      if (photo.file) URL.revokeObjectURL(photo.url);
      photos.splice(index, 1);
      drawPhotos();
      byId('photo-input').focus();
    });
    remove.setAttribute('aria-label', `Remove product photo ${index + 1}`);
    tile.append(image, element('span', index === 0 ? 'Cover photo' : `Photo ${index + 1}`), remove);
    list.append(tile);
  });
}

byId('photo-input').addEventListener('change', event => {
  const files = Array.from(event.target.files);
  event.target.value = '';
  if (photos.length + files.length > 4) return message('editor-error', 'Upload up to four product photos.');
  if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024)) {
    return message('editor-error', 'Choose JPG, PNG or WebP files under 20 MB each.');
  }
  photos.push(...files.map(file => ({ file, url: URL.createObjectURL(file) })));
  message('editor-error', '');
  drawPhotos();
});

function startEditor(product) {
  editing = product;
  productForm.reset();
  byId('editor-title').textContent = product ? 'Edit product' : 'Add product';
  byId('save-product').textContent = product ? 'Save changes' : 'Add product';
  productForm.elements.name.value = product?.n ?? '';
  productForm.elements.category.value = product?.c ?? '';
  productForm.elements.price.value = product?.p ?? '';
  productForm.elements.previous.value = product?.o ?? '';
  productForm.elements.description.value = product?.d ?? '';
  const categories = [...new Set(products.map(item => item.c))].sort();
  byId('category-list').replaceChildren(...categories.map(category => new Option(category)));
  const colours = product?.cols ?? [];
  colourOptions = [...palette.keys()].filter(colour => !colours.some(saved => saved !== colour && saved.toLowerCase() === colour.toLowerCase())).concat(colours.filter(colour => !palette.has(colour)));
  selected = new Set(colours);
  photos = (product?.imgs ?? []).map(url => ({ url }));
  drawColours();
  drawPhotos();
  message('editor-error', '');
  editor.showModal();
  productForm.elements.name.focus();
}

editor.addEventListener('close', () => {
  for (const photo of photos) if (photo.file) URL.revokeObjectURL(photo.url);
  photos = [];
});

async function compressPhoto(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error(`Could not open ${file.name}. Choose another photo.`); }
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.75, 0.60, 0.45, 0.30]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 512 * 1024) return blob;
    }
    throw new Error(`Could not resize ${file.name}. Choose a smaller photo.`);
  } finally {
    bitmap.close();
  }
}

function busy(dialog, value) {
  for (const control of dialog.querySelectorAll('fieldset, .dialog-head button, .dialog-actions button')) control.disabled = value;
  dialog.setAttribute('aria-busy', value);
}

productForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!photos.length) return message('editor-error', 'Add at least one product photo.');
  const fields = productForm.elements;
  const product = {
    n: fields.name.value.trim(), c: fields.category.value.trim(), d: fields.description.value.trim(),
    p: Number(fields.price.value), o: fields.previous.value ? Number(fields.previous.value) : null,
    cols: [...selected], imgs: photos.filter(photo => !photo.file).map(photo => photo.url),
  };
  if (!product.n || !product.c) return message('editor-error', 'Enter a product name and category.');
  if (product.o !== null && product.o <= product.p) return message('editor-error', 'The previous price must be higher than the current price.');
  const submit = byId('save-product');
  const label = submit.textContent;
  busy(editor, true);
  submit.textContent = 'Saving…';
  message('editor-error', '');
  try {
    const body = new FormData();
    body.append('product', JSON.stringify(product));
    for (const photo of photos) if (photo.file) body.append('photo', await compressPhoto(photo.file), 'product.jpg');
    const saved = await api(editing ? `${endpoint}/${editing.id}` : endpoint, { method: editing ? 'PUT' : 'POST', body }, true);
    products = editing ? products.map(item => item.id === saved.id ? saved : item) : [...products, saved];
    byId('search').value = '';
    drawList();
    message('notice', editing ? 'Product updated on the storefront.' : 'Product added to the storefront.');
    editor.close();
    byId('new-product').focus();
  } catch (error) {
    message('editor-error', error.message);
  } finally {
    busy(editor, false);
    submit.textContent = label;
  }
});

function startDelete(product) {
  deleting = product;
  byId('delete-name').textContent = product.n;
  message('delete-error', '');
  deleteDialog.showModal();
}

byId('delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  busy(deleteDialog, true);
  byId('confirm-delete').textContent = 'Deleting…';
  message('delete-error', '');
  try {
    await api(`${endpoint}/${deleting.id}`, { method: 'DELETE' }, true);
    products = products.filter(product => product.id !== deleting.id);
    drawList();
    message('notice', 'Product removed from the storefront.');
    deleteDialog.close();
    byId('new-product').focus();
  } catch (error) {
    message('delete-error', error.message);
  } finally {
    busy(deleteDialog, false);
    byId('confirm-delete').textContent = 'Delete product';
  }
});

for (const dialog of [editor, deleteDialog]) {
  dialog.addEventListener('cancel', event => { if (dialog.getAttribute('aria-busy') === 'true') event.preventDefault(); });
  for (const close of dialog.querySelectorAll('[data-close]')) close.addEventListener('click', () => dialog.close());
}

init();
