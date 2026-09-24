import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.API_BASE || 'http://localhost:4000';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<800'],
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: 'admin@resonaai.local', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(login, { 'login 200': (r) => r.status === 200 });
  const body = login.json();
  return { token: body.accessToken };
}

export default function (data) {
  const health = http.get(`${BASE}/api/health`);
  check(health, { 'health 200': (r) => r.status === 200 });

  const sessions = http.get(`${BASE}/api/sessions`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  check(sessions, { 'sessions 200': (r) => r.status === 200 });

  sleep(1);
}
