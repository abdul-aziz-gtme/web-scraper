// Hand-curated, high-confidence fingerprints for the platforms that matter most
// to cold-outbound enrichment. These guarantee recall on CMS/CRM/martech — the
// user's stated priority — and run cheaply (meta generator, known script hosts,
// response headers, cookies). The pruned webappanalyzer DB (fingerprints.generated)
// covers the long tail on top of these.
//
// Authoring format: raw strings are Wappalyzer-style (regex + optional
// \;version:\1 \;confidence:NN tags). `meta`/`headers`/`cookies` are keyed by
// name; an empty pattern ("") means "presence of that key is enough".

import { buildTech, type RawTechData } from "./buildTech.js";
import type { Technology } from "./types.js";

const RAW: RawTechData[] = [
  // ---------------------------------------------------------------- CMS
  {
    name: "WordPress",
    cats: ["cms"],
    html: ["/wp-content/", "/wp-includes/"],
    scriptSrc: ["/wp-content/", "/wp-includes/"],
    meta: { generator: "WordPress ?([\\d.]+)?\\;version:\\1" },
    headers: { link: "wp-json\\;confidence:60" },
    cookies: { "wordpress_logged_in": "" },
  },
  {
    name: "Webflow",
    cats: ["cms"],
    html: ["data-wf-(?:page|site|domain)", "\\.w-(?:nav|slider|tab)"],
    scriptSrc: ["assets[\\-_.]?(?:global)?\\.website-files\\.com", "d3e54v103rb2sx\\.cloudfront\\.net"],
    meta: { generator: "Webflow" },
  },
  {
    name: "Framer",
    cats: ["cms"],
    html: ["framerusercontent\\.com", "__framer", "data-framer-"],
    scriptSrc: ["framerusercontent\\.com", "events\\.framer\\.com", "framer\\.com/m/"],
    meta: { generator: "Framer" },
  },
  {
    name: "Shopify",
    cats: ["cms", "ecommerce"],
    html: ["Shopify\\.theme", "/cdn/shop/"],
    scriptSrc: ["cdn\\.shopify\\.com", "shopifycloud", "shopifyapps\\.com"],
    headers: { "x-shopify-stage": "", "x-sorting-hat-shopid": "", "x-shopid": "" },
    cookies: { "_shopify_y": "", "_shopify_s": "" },
  },
  {
    name: "Squarespace",
    cats: ["cms"],
    html: ["static1\\.squarespace\\.com", "squarespace\\.com", "Static\\.SQUARESPACE_CONTEXT"],
    scriptSrc: ["static1?\\.squarespace\\.com", "assets\\.squarespace\\.com"],
    meta: { generator: "Squarespace" },
    cookies: { "crumb": "\\;confidence:40" },
  },
  {
    name: "Wix",
    cats: ["cms"],
    html: ["static\\.wixstatic\\.com", "wix\\.com", "wixBiSession"],
    scriptSrc: ["static\\.parastorage\\.com", "static\\.wixstatic\\.com"],
    meta: { generator: "Wix\\.com" },
    headers: { "x-wix-request-id": "", "x-wix-renderer-server": "" },
  },
  {
    name: "HubSpot CMS",
    cats: ["cms"],
    html: ["hs-sites\\.com", "hubspotusercontent", "_hsq\\b"],
    scriptSrc: ["hs-sites\\.com", "hubspotusercontent-?\\w*\\.net", "cdn2?\\.hubspot\\.net"],
    headers: { "x-hs-cache-config": "", "x-hubspot-": "" },
    implies: ["HubSpot"],
  },
  {
    name: "Ghost",
    cats: ["cms"],
    // NB: avoid bare "content/themes/" — it collides with WordPress's
    // /wp-content/themes/. Use Ghost-specific markers only.
    html: ["ghost-url|gh-(?:head|foot)\\b|/ghost/api/"],
    scriptSrc: ["/ghost/", "unpkg\\.com/@tryghost", "sodo-search"],
    meta: { generator: "Ghost ?([\\d.]+)?\\;version:\\1" },
  },
  {
    name: "Duda",
    cats: ["cms"],
    html: ["dmAlbum|dmRespRow|dudaone|_dm\\b", "window\\._dmpt"],
    scriptSrc: ["i(?:rp)?\\.cdn-website\\.com", "static\\.cdn-website\\.com"],
    meta: { generator: "Duda" },
  },
  {
    name: "Carrd",
    cats: ["cms"],
    html: ["carrd\\.co"],
    scriptSrc: ["\\.carrd\\.co"],
    meta: { author: "Carrd\\;confidence:50" },
  },
  {
    name: "Drupal",
    cats: ["cms"],
    html: ["/sites/(?:default|all)/", "Drupal\\.settings", "data-drupal"],
    scriptSrc: ["/sites/default/files/", "/core/misc/drupal"],
    meta: { generator: "Drupal ?([\\d]+)?\\;version:\\1" },
    headers: { "x-generator": "Drupal", "x-drupal-cache": "" },
  },
  {
    name: "Joomla",
    cats: ["cms"],
    html: ["/media/jui/", "option=com_", "/media/system/js/"],
    meta: { generator: "Joomla! ?([\\d.]+)?\\;version:\\1" },
  },
  // Static-site generators — detected purely via meta generator (zero false
  // positives). Useful outreach signal ("dev-built marketing site").
  {
    name: "Hugo",
    cats: ["cms"],
    meta: { generator: "Hugo ?([\\d.]+)?\\;version:\\1" },
  },
  {
    name: "Jekyll",
    cats: ["cms"],
    meta: { generator: "Jekyll ?v?([\\d.]+)?\\;version:\\1" },
  },
  {
    name: "Eleventy",
    cats: ["cms"],
    meta: { generator: "Eleventy ?v?([\\d.]+)?\\;version:\\1" },
  },

  // ---------------------------------------------------------------- E-commerce
  {
    name: "WooCommerce",
    cats: ["ecommerce"],
    html: ["woocommerce", "wc-block", "is-woocommerce"],
    scriptSrc: ["/plugins/woocommerce/"],
    cookies: { "woocommerce_items_in_cart": "", "woocommerce_cart_hash": "" },
    implies: ["WordPress"],
  },
  {
    name: "BigCommerce",
    cats: ["ecommerce"],
    // Rely on technical signals only — the word "bigcommerce" shows up in
    // competitor marketing copy, which would false-positive on html text.
    scriptSrc: ["cdn\\d*\\.bigcommerce\\.com", "microapps\\.bigcommerce\\.com"],
    headers: { "x-bc-": "" },
  },
  {
    name: "Magento",
    cats: ["ecommerce"],
    html: ["Magento_|/static/version\\d|mage/cookies", "var BLANK_URL"],
    cookies: { "X-Magento-Vary": "" },
  },
  {
    name: "Snipcart",
    cats: ["ecommerce"],
    scriptSrc: ["cdn\\.snipcart\\.com"],
    html: ["snipcart"],
  },

  // ---------------------------------------------------------------- CRM / marketing automation
  {
    name: "HubSpot",
    cats: ["crm", "marketing"],
    html: ["_hsq\\b|hbspt\\.|hs-scripts"],
    scriptSrc: [
      "js\\.hs-scripts\\.com",
      "js\\.hs-analytics\\.net",
      "js\\.hsforms\\.(?:net|com)",
      "js\\.hscollectedforms\\.net",
      "js\\.usemessages\\.com",
      "track\\.hubspot\\.com",
    ],
    cookies: { "hubspotutk": "", "__hstc": "" },
  },
  {
    name: "Salesforce",
    cats: ["crm"],
    // Web-to-lead form action is a strong, unambiguous signal; the bare brand
    // name in marketing copy is not, so it's intentionally excluded.
    html: ["webto\\.salesforce\\.com|Web2Lead|salesforce_w2l", "live(?:agent|chat)\\.salesforceliveagent"],
    scriptSrc: ["\\.salesforce\\.com", "force\\.com/", "\\.salesforceliveagent\\.com"],
    url: ["\\.force\\.com|\\.salesforce-sites\\.com"],
  },
  {
    name: "Salesforce Pardot",
    cats: ["crm", "marketing"],
    html: ["pi\\.pardot\\.com|pardot"],
    scriptSrc: ["pi\\.pardot\\.com", "pi\\.demandbase\\.com/pardot"],
    cookies: { "visitor_id": "\\;confidence:40" },
    implies: ["Salesforce"],
  },
  {
    name: "Marketo",
    cats: ["crm", "marketing"],
    html: ["Munchkin\\.init|mktoForm|marketo"],
    scriptSrc: ["munchkin\\.marketo\\.net", "\\.mktoresp\\.com", "\\.marketo\\.com"],
    cookies: { "_mkto_trk": "" },
  },
  {
    name: "Pipedrive",
    cats: ["crm"],
    html: ["pipedrive"],
    scriptSrc: ["leadbooster-chat\\.pipedrive\\.com", "webforms\\.pipedrive\\.com", "\\.pipedrive\\.com"],
  },
  {
    name: "Zoho CRM",
    cats: ["crm"],
    html: ["zoho", "zforms|salesiq"],
    scriptSrc: ["salesiq\\.zoho\\.com", "\\.zoho\\.com", "zohopublic\\.com", "\\.zohocdn\\.com"],
    cookies: { "zalb_": "\\;confidence:30" },
  },
  {
    name: "ActiveCampaign",
    cats: ["crm", "marketing"],
    html: ["activecampaign|active-?hosted"],
    scriptSrc: ["\\.activehosted\\.com", "\\.active-hosted\\.com", "prototype\\.activehosted"],
  },
  {
    name: "Klaviyo",
    cats: ["marketing", "ecommerce"],
    html: ["klaviyo", "_learnq"],
    scriptSrc: ["static\\.klaviyo\\.com", "\\.klaviyo\\.com/onsite"],
  },
  {
    name: "Mailchimp",
    cats: ["marketing"],
    html: ["mc4wp|\\.list-manage\\.com"],
    scriptSrc: ["chimpstatic\\.com", "\\.list-manage\\.com", "downloads\\.mailchimp\\.com"],
  },

  // ---------------------------------------------------------------- Analytics / ads
  {
    name: "Google Analytics",
    cats: ["analytics"],
    html: ["GoogleAnalyticsObject|ga\\('create|google-analytics\\.com/analytics"],
    scriptSrc: ["google-analytics\\.com/analytics\\.js", "google-analytics\\.com/ga\\.js"],
  },
  {
    name: "Google Analytics 4",
    cats: ["analytics"],
    html: ["gtag\\('config',\\s*'G-|googletagmanager\\.com/gtag/js"],
    scriptSrc: ["googletagmanager\\.com/gtag/js"],
  },
  {
    name: "Google Tag Manager",
    cats: ["analytics"],
    html: ["googletagmanager\\.com/ns\\.html|GTM-[A-Z0-9]+"],
    scriptSrc: ["googletagmanager\\.com/gtm\\.js"],
  },
  {
    name: "Meta Pixel",
    cats: ["ads", "analytics"],
    html: ["fbq\\(|fbevents\\.js|_fbq\\b"],
    scriptSrc: ["connect\\.facebook\\.net/.+/fbevents\\.js"],
  },
  {
    name: "LinkedIn Insight Tag",
    cats: ["ads", "analytics"],
    html: ["_linkedin_partner_id|_linkedin_data_partner"],
    scriptSrc: ["snap\\.licdn\\.com"],
  },
  {
    name: "Hotjar",
    cats: ["analytics"],
    html: ["_hjSettings|hjSiteSettings|hotjar"],
    scriptSrc: ["static\\.hotjar\\.com", "script\\.hotjar\\.com"],
  },
  {
    name: "Segment",
    cats: ["analytics"],
    html: ["analytics\\.load\\(|analytics\\.track\\(|window\\.analytics"],
    scriptSrc: ["cdn\\.segment\\.com/analytics\\.js"],
  },
  {
    name: "TikTok Pixel",
    cats: ["ads", "analytics"],
    html: ["ttq\\.(?:load|page|track)"],
    scriptSrc: ["analytics\\.tiktok\\.com"],
  },
  {
    name: "Twitter Ads",
    cats: ["ads"],
    html: ["twq\\(|twttr\\.conversion"],
    scriptSrc: ["static\\.ads-twitter\\.com"],
  },
  {
    name: "Google Ads",
    cats: ["ads"],
    html: ["googleadservices\\.com|google_conversion|AW-[0-9]+"],
    scriptSrc: ["googleadservices\\.com/pagead", "googletagmanager\\.com/gtag/js\\?id=AW-"],
  },

  // ---------------------------------------------------------------- Frameworks
  {
    name: "Next.js",
    cats: ["frameworks"],
    html: ["/_next/static|__NEXT_DATA__|id=\"__next\""],
    scriptSrc: ["/_next/static/"],
    headers: { "x-powered-by": "Next\\.js", "x-nextjs-": "" },
    implies: ["React"],
  },
  {
    name: "React",
    cats: ["frameworks"],
    html: ["data-reactroot|data-reactid|__REACT_DEVTOOLS_GLOBAL_HOOK__"],
    scriptSrc: ["react(?:-dom)?(?:\\.production|\\.development)?\\.min\\.js", "/react@\\d"],
  },
  {
    name: "Nuxt.js",
    cats: ["frameworks"],
    html: ["__NUXT__|/_nuxt/|id=\"__nuxt\""],
    scriptSrc: ["/_nuxt/"],
    implies: ["Vue.js"],
  },
  {
    name: "Vue.js",
    cats: ["frameworks"],
    html: ["data-v-[0-9a-f]{6,8}|__vue__|id=\"app\"[^>]*data-v-"],
    scriptSrc: ["vue(?:\\.runtime)?(?:\\.global)?(?:\\.prod)?\\.js", "/vue@\\d"],
  },
  {
    name: "Gatsby",
    cats: ["frameworks"],
    html: ["___gatsby|gatsby-", "window\\.___chunkMapping"],
    scriptSrc: ["/webpack-runtime-|/app-[0-9a-f]+\\.js"],
    implies: ["React"],
  },
  {
    name: "Svelte",
    cats: ["frameworks"],
    html: ["svelte-[0-9a-z]{6}|__sveltekit", "data-sveltekit"],
  },
  {
    name: "Angular",
    cats: ["frameworks"],
    html: ["ng-version=|ng-app=|_nghost-|_ngcontent-"],
  },
  {
    name: "Astro",
    cats: ["frameworks"],
    html: ["astro-island|/_astro/|astro-route-announcer"],
    meta: { generator: "Astro ?([\\d.]+)?\\;version:\\1" },
  },
  {
    name: "jQuery",
    cats: ["frameworks"],
    scriptSrc: ["jquery(?:-|\\.)(\\d+(?:\\.\\d+)+)?(?:\\.min)?\\.js\\;version:\\1", "/jquery@\\d"],
  },

  // ---------------------------------------------------------------- Chat / schedulers
  {
    name: "Intercom",
    cats: ["chat", "crm"],
    html: ["intercomSettings|intercom\\("],
    scriptSrc: ["widget\\.intercom\\.io", "js\\.intercomcdn\\.com"],
  },
  {
    name: "Drift",
    cats: ["chat", "marketing"],
    html: ["drift\\.load|driftt"],
    scriptSrc: ["js\\.driftt\\.com", "js\\.drift\\.com"],
  },
  {
    name: "Zendesk Chat",
    cats: ["chat"],
    html: ["zE\\(|zendesk|zopim"],
    scriptSrc: ["static\\.zdassets\\.com", "\\.zendesk\\.com", "\\.zopim\\.com"],
  },
  {
    name: "Crisp",
    cats: ["chat"],
    html: ["\\$crisp|CRISP_WEBSITE_ID"],
    scriptSrc: ["client\\.crisp\\.chat"],
  },
  {
    name: "Tidio",
    cats: ["chat"],
    scriptSrc: ["code\\.tidio\\.co"],
  },
  {
    name: "LiveChat",
    cats: ["chat"],
    html: ["__lc\\.|LiveChatWidget"],
    scriptSrc: ["cdn\\.livechatinc\\.com"],
  },
  {
    name: "Tawk.to",
    cats: ["chat"],
    html: ["Tawk_API"],
    scriptSrc: ["embed\\.tawk\\.to"],
  },
  {
    name: "Calendly",
    cats: ["scheduler"],
    html: ["calendly"],
    scriptSrc: ["assets\\.calendly\\.com"],
  },
  {
    name: "HubSpot Meetings",
    cats: ["scheduler"],
    scriptSrc: ["meetings\\.hubspot\\.com", "static\\.hsappstatic\\.net/MeetingsEmbed"],
    implies: ["HubSpot"],
  },

  // ---------------------------------------------------------------- Hosting / CDN
  {
    name: "Cloudflare",
    cats: ["hosting"],
    headers: { "cf-ray": "", "server": "cloudflare" },
  },
  {
    name: "Vercel",
    cats: ["hosting"],
    headers: { "server": "Vercel", "x-vercel-id": "", "x-vercel-cache": "" },
  },
  {
    name: "Netlify",
    cats: ["hosting"],
    headers: { "server": "Netlify", "x-nf-request-id": "" },
  },
  {
    name: "Amazon CloudFront",
    cats: ["hosting"],
    headers: { "via": "cloudfront", "x-amz-cf-id": "" },
  },
  {
    name: "Fastly",
    cats: ["hosting"],
    headers: { "x-served-by": "cache-", "x-fastly-request-id": "", "fastly-": "" },
  },
  {
    name: "GitHub Pages",
    cats: ["hosting"],
    headers: { "server": "GitHub\\.com" },
  },
  {
    name: "Amazon S3",
    cats: ["hosting"],
    headers: { "server": "AmazonS3", "x-amz-request-id": "" },
  },
];

export const CURATED: Technology[] = RAW.map(buildTech);
