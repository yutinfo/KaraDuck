export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; img-src 'self' data: https://i.ytimg.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.firebasedatabase.app; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export const ADMIN_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Security-Policy': SECURITY_HEADERS['Content-Security-Policy']
    .replace("script-src 'self' https://www.youtube.com https://s.ytimg.com", "script-src 'self' https://www.gstatic.com https://apis.google.com")
    .replace('frame-src https://www.youtube.com', 'frame-src https://*.firebaseapp.com')
    .replace("connect-src 'self' https://*.firebasedatabase.app", "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com"),
};

export const securityHeadersFor = pathname => ['/admin', '/admin.html'].includes(pathname) ? ADMIN_SECURITY_HEADERS : SECURITY_HEADERS;
