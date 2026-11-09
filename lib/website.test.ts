import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPage, pickPages, buildFacts, normalizeSiteUrl, robotsAllows, decodeEntities } from './borga/website-extract';

const HOME = `<!doctype html><html><head>
<title>Accra Works &amp; Co. | Logistics software</title>
<meta name="description" content="We help West African logistics teams plan routes, track deliveries and get paid faster.">
<script>var x = "<p>this is not content and has enough words to look like a paragraph for sure</p>"; document.write("hi")</script>
<style>.a{color:red}</style></head>
<body>
<header><nav><a href="/">Home</a><a href="/about-us">About us</a><a href="/services/route-planning">Services</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a><a href="/login">Log in</a><a href="/blog/tag/news">News</a></nav></header>
<main>
<h1>Move goods faster across West Africa</h1>
<p>Accra Works builds route planning and delivery tracking software for fleets of five to five hundred vehicles.</p>
<h2>Route planning</h2><h2>Live delivery tracking</h2><h2>Driver payments</h2><h2>Contact us</h2>
<p>We accept all cookies and our privacy policy is on the footer so this line must be ignored entirely.</p>
</main>
<footer><a href="https://www.linkedin.com/company/accra-works?trk=1">LinkedIn</a> <a href="https://twitter.com/accraworks">Twitter</a>
<a href="mailto:hello@accraworks.com">Email</a> <a href="tel:+233 30 123 4567">Call</a> &copy; 2026 All rights reserved.</footer>
</body></html>`;

test('a page is read for its title, description, headings, sentences, contact details and social links, and scripts are ignored', () => {
  const p = extractPage(HOME, 'https://accraworks.com/');
  assert.equal(p.title, 'Accra Works & Co. | Logistics software');
  assert.equal(p.description, 'We help West African logistics teams plan routes, track deliveries and get paid faster.');
  assert.deepEqual(p.headings, ['Move goods faster across West Africa', 'Route planning', 'Live delivery tracking', 'Driver payments', 'Contact us']);
  assert.deepEqual(p.paragraphs, ['Accra Works builds route planning and delivery tracking software for fleets of five to five hundred vehicles.']);
  assert.deepEqual(p.emails, ['hello@accraworks.com']);
  assert.deepEqual(p.phones, ['+233 30 123 4567']);
  assert.deepEqual(p.socials, ['https://www.linkedin.com/company/accra-works', 'https://twitter.com/accraworks']);
  assert.ok(!p.paragraphs.join(' ').includes('document.write'), 'script content is not page text');
  assert.ok(!p.paragraphs.some((x) => /cookie/i.test(x)), 'cookie notices are not content');
});

test('entities are decoded, tags never survive, and markup in a page cannot become markup in our output', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#8217;s &#x41; &nbsp;x &unknown;'), 'Tom & Jerry ’s A  x &unknown;');
  const evil = extractPage('<title>&lt;img src=x onerror=alert(1)&gt;</title><main><p>Hello <b>there</b> <script>alert(1)</script> this is a sentence long enough to count as a paragraph here.</p></main>', 'https://x.com/');
  assert.ok(!/<script|<b>/i.test(evil.paragraphs.join(' ')), 'tags are removed');
  assert.equal(evil.paragraphs[0], 'Hello there this is a sentence long enough to count as a paragraph here.');
  assert.equal(evil.title, '<img src=x onerror=alert(1)>', 'an encoded tag is kept as text (React shows it as text; it is never inserted as HTML)');
  assert.equal(extractPage('', 'https://x.com/').title, '');
  assert.deepEqual(extractPage('not html at all', 'https://x.com/').links, []);
});

test('the pages worth reading are about, services, pricing and contact on the same site, not logins, tags, files or other sites', () => {
  const home = extractPage(HOME + '<a href="https://other.com/about">x</a><a href="/files/brochure.pdf">Services brochure</a>', 'https://accraworks.com/');
  const picked = pickPages(home);
  assert.ok(picked.includes('https://accraworks.com/about-us'));
  assert.ok(picked.includes('https://accraworks.com/services/route-planning'));
  assert.ok(picked.includes('https://accraworks.com/pricing'));
  assert.ok(picked.includes('https://accraworks.com/contact'));
  assert.ok(!picked.some((u) => /login|tag|other\.com|\.pdf/.test(u)));
  assert.equal(pickPages(home, 2).length, 2);
  assert.equal(new Set(picked).size, picked.length);
});

test('facts are proposed from what the site says, each with its source, and nothing is invented when there is little', () => {
  const home = extractPage(HOME, 'https://accraworks.com/');
  const about = extractPage('<title>About</title><main><p>Founded in Accra in 2019, we started by moving parcels for two supermarkets and now serve 140 fleets.</p></main>', 'https://accraworks.com/about-us');
  const services = extractPage('<title>Route planning</title><main><h1>Route planning</h1><h2>Multi-stop optimisation</h2><p>Plan the cheapest route for every vehicle and driver each morning.</p></main>', 'https://accraworks.com/services/route-planning');
  const facts = buildFacts([home, about, services], 'https://accraworks.com/');
  const by = (t: RegExp) => facts.find((f) => t.test(f.title))!;
  assert.equal(by(/What does/).answer, 'We help West African logistics teams plan routes, track deliveries and get paid faster.');
  assert.equal(by(/What does/).category, 'company');
  assert.match(by(/About the company/).answer, /Founded in Accra in 2019/);
  assert.equal(by(/About the company/).source, 'https://accraworks.com/about-us');
  assert.match(by(/Services & products/).answer, /Live delivery tracking/);
  assert.ok(!/Contact us/.test(by(/Services & products/).answer), 'navigation-style headings are not services');
  assert.equal(by(/Services & products/).category, 'services');
  assert.match(by(/Contact details/).answer, /hello@accraworks\.com.*\+233 30 123 4567/);
  assert.match(by(/Social/).answer, /linkedin\.com\/company\/accra-works/);
  assert.equal(new Set(facts.map((f) => f.id)).size, facts.length);
  assert.deepEqual(buildFacts([extractPage('<html><body></body></html>', 'https://empty.com/')], 'https://empty.com/'), [], 'an empty page proposes nothing');
});

test('an address typed by a person becomes a safe https URL, or nothing', () => {
  assert.equal(normalizeSiteUrl('acme.com'), 'https://acme.com/');
  assert.equal(normalizeSiteUrl('www.acme.com/about'), 'https://www.acme.com/about');
  assert.equal(normalizeSiteUrl('  HTTP://acme.com/#top '), 'https://acme.com/');
  assert.equal(normalizeSiteUrl('https://acme.com/?a=1'), 'https://acme.com/?a=1');
  for (const bad of ['', 'localhost', 'not a url', 'ftp://acme.com', 'javascript:alert(1)', 'https://user:pw@acme.com', 'file:///etc/passwd', 'acme', 'x'.repeat(400)]) assert.equal(normalizeSiteUrl(bad), null, bad);
});

test('robots.txt is respected: our own rules first, then the wildcard, longest match wins, empty disallow allows', () => {
  const robots = 'User-agent: *\nDisallow: /private/\nAllow: /private/public\nDisallow: /*.json$\n\nUser-agent: BorgaBot\nDisallow: /nobots\n';
  assert.equal(robotsAllows(robots, '/about'), true);
  assert.equal(robotsAllows(robots, '/nobots/x'), false, 'rules for our name apply');
  assert.equal(robotsAllows(robots, '/private/x'), true, 'when there is a group for our name, the wildcard group is not used');
  const star = 'User-agent: *\nDisallow: /private/\nAllow: /private/public\nDisallow: /*.json$\n';
  assert.equal(robotsAllows(star, '/private/secret'), false);
  assert.equal(robotsAllows(star, '/private/public/page'), true, 'the longer Allow wins');
  assert.equal(robotsAllows(star, '/data.json'), false);
  assert.equal(robotsAllows(star, '/data.json5'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', '/anything'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n', '/anything'), false);
  assert.equal(robotsAllows('', '/x'), true);
  assert.equal(robotsAllows('garbage ::: not robots', '/x'), true);
});

// ── reading a whole site (fake web) ───────────────────────────────────────────────────────────────────────────────────

import { readSite, WebsiteError, type Get } from './borga/website-read';

function web(pages: Record<string, { status?: number; type?: string; body: string; finalUrl?: string }>) {
  const calls: string[] = [];
  const get: Get = async (url) => {
    calls.push(url);
    const p = pages[url];
    if (!p) return new Response('not found', { status: 404 });
    const r = new Response(p.body, { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html; charset=utf-8' } });
    Object.defineProperty(r, 'url', { value: p.finalUrl ?? url });
    return r;
  };
  return { get, calls };
}
const SITE = 'https://accraworks.com';
const base = {
  [`${SITE}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /contact\n' },
  [`${SITE}/`]: { body: HOME },
  [`${SITE}/about-us`]: { body: '<title>About</title><main><p>Founded in Accra in 2019, we started by moving parcels for two supermarkets and now serve 140 fleets.</p></main>' },
  [`${SITE}/services/route-planning`]: { body: '<title>Route planning</title><main><h2>Multi-stop optimisation</h2><p>Plan the cheapest route for every vehicle and driver each morning.</p></main>' },
  [`${SITE}/pricing`]: { body: '<title>Pricing</title><main><p>Plans start at one hundred cedis per vehicle per month, billed monthly.</p></main>' },
};

test('a site is read: home first, then its about, services and pricing pages, skipping what robots.txt forbids', async () => {
  const w = web(base);
  const r = await readSite('accraworks.com', w.get);
  assert.equal(r.site, `${SITE}/`);
  assert.deepEqual(r.pages.map((p) => new URL(p.url).pathname).sort(), ['/', '/about-us', '/pricing', '/services/route-planning']);
  assert.ok(!w.calls.includes(`${SITE}/contact`), 'a page robots.txt forbids is never requested');
  assert.deepEqual(r.skipped, [{ url: `${SITE}/contact`, reason: 'robots.txt asks readers to skip it' }]);
  assert.ok(r.facts.some((f) => f.title === 'About the company' && /Founded in Accra/.test(f.answer)));
  assert.ok(r.facts.some((f) => /Pricing/.test(f.title) && /one hundred cedis/.test(f.answer)));
  assert.equal(w.calls[0], `${SITE}/robots.txt`, 'robots.txt is read before anything else');
});

test('a site that forbids readers, or cannot be reached, gives a message a person can act on', async () => {
  const closed = web({ ...base, [`${SITE}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /\n' } });
  await assert.rejects(readSite('accraworks.com', closed.get), (e: unknown) => e instanceof WebsiteError && /robots\.txt/.test(e.message));
  assert.deepEqual(closed.calls, [`${SITE}/robots.txt`], 'nothing else was requested');
  await assert.rejects(readSite('nowhere.example', web({}).get), (e: unknown) => e instanceof WebsiteError && /Could not read nowhere\.example/.test(e.message));
  await assert.rejects(readSite('not a site', web({}).get), (e: unknown) => e instanceof WebsiteError && /does not look like a website/.test(e.message));
  const blocked = (async () => { throw new Error('Refusing to fetch an internal address'); }) as Get;
  await assert.rejects(readSite('intranet.corp', blocked), (e: unknown) => e instanceof WebsiteError && /not allowed/.test(e.message));
});

test('a page that redirects to another site, is not a web page, or errors is skipped and the rest still read', async () => {
  const w = web({
    ...base,
    [`${SITE}/robots.txt`]: { status: 404, body: 'none' },
    [`${SITE}/about-us`]: { body: '<title>x</title>', finalUrl: 'https://elsewhere.com/about' },
    [`${SITE}/services/route-planning`]: { type: 'application/pdf', body: '%PDF' },
    [`${SITE}/pricing`]: { status: 500, body: 'oops' },
  });
  return readSite('accraworks.com', w.get).then((r) => {
    assert.deepEqual(r.pages.map((p) => new URL(p.url).pathname), ['/']);
    const reasons = Object.fromEntries(r.skipped.map((s) => [new URL(s.url).pathname, s.reason]));
    assert.equal(reasons['/about-us'], 'redirected to another site');
    assert.equal(reasons['/services/route-planning'], 'not a web page');
    assert.equal(reasons['/pricing'], 'the site answered 500');
    assert.ok(r.facts.length > 0, 'the home page alone still gives something');
  });
});

test('a home page that redirects to the www address is followed, and its pages are then read on that address', async () => {
  const W = 'https://www.accraworks.com';
  const w = web({
    [`${SITE}/robots.txt`]: { status: 404, body: '' },
    [`${SITE}/`]: { body: HOME.replace(/href="\//g, `href="${W}/`), finalUrl: `${W}/` },
    [`${W}/about-us`]: { body: '<title>About</title><main><p>Founded in Accra in 2019, we started by moving parcels for two supermarkets and now serve 140 fleets.</p></main>' },
  });
  const r = await readSite('accraworks.com', w.get);
  assert.equal(r.site, `${W}/`);
  assert.ok(r.pages.some((p) => p.url === `${W}/about-us`));
});

test('at most five extra pages are read', async () => {
  const links = Array.from({ length: 12 }, (_, i) => `<a href="/services/s${i}">Service ${i}</a>`).join('');
  const pages: Record<string, { body: string }> = { [`${SITE}/`]: { body: `<title>T</title><main>${links}</main>` } };
  for (let i = 0; i < 12; i++) pages[`${SITE}/services/s${i}`] = { body: `<title>S${i}</title><main><p>Service number ${i} does something useful for your fleet every single day.</p></main>` };
  const w = web({ ...pages, [`${SITE}/robots.txt`]: { status: 404, body: '' } });
  const r = await readSite('accraworks.com', w.get);
  assert.equal(r.pages.length, 6);
});

test('marketing questions and calls to action are not listed as services, and services pages come before the home page', () => {
  const home = extractPage('<title>Acme</title><main><h2>How about a quick demonstration?</h2><h2>Take a minute to meet some of our customers</h2><h2>Fleet routing</h2><h2>Driver payroll</h2><h2>Ready to get started?</h2></main>', 'https://acme.com/');
  const noServicesPage = buildFacts([home], 'https://acme.com/').find((f) => /Services/.test(f.title))!;
  assert.equal(noServicesPage.answer, 'Listed on the website: Fleet routing; Driver payroll.');
  const svc = extractPage('<title>Services</title><main><h2>Invoicing</h2><h2>Reporting</h2></main>', 'https://acme.com/services');
  const withPage = buildFacts([home, svc], 'https://acme.com/').find((f) => /Services/.test(f.title))!;
  assert.equal(withPage.answer, 'Listed on the website: Invoicing; Reporting; Fleet routing; Driver payroll.', 'services pages first, then the home page, without the marketing lines');
});
