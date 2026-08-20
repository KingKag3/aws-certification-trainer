/**
 * Optional "support this project" link.
 *
 * Set `handle` to your Ko-fi username and the link appears in the footer and on
 * the Profile page. Leave it empty and nothing renders anywhere — the app has
 * no other opinion about it.
 *
 * Deliberately a plain link rather than Ko-fi's embed widget: the widget loads
 * a third-party script on every page view, which would break the promise that a
 * signed-out visitor makes zero external requests.
 */

export const support = {
  /** Your Ko-fi username, i.e. the part after ko-fi.com/ — empty disables it. */
  handle: '',

  /** Shown next to the link. Keep it short and honest. */
  blurb: 'This is free and always will be. If it helped you pass, a coffee is appreciated.',
};

export const supportUrl = () => (support.handle ? `https://ko-fi.com/${support.handle}` : null);
