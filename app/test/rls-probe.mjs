// ===================================================================
// RLS VERIFICATION — unauthenticated probe of the live Supabase project
//
// The migration risk register (R14) says the publishable key sitting in
// client source is "normal IF RLS is sound — verify during Phase 10",
// and CLAUDE.md's cutover gate says RLS must be checked against the live
// project rather than assumed from reading the policy files.
//
// This does that check the only way it can be checked: by BEING an
// anonymous visitor holding the public key, and confirming that every
// table and RPC the app touches refuses to hand anything over.
//
// Read-only apart from one deliberate INSERT that is expected to be
// refused — if it ever succeeds, that is the finding.
// ===================================================================

const URL = 'https://bqknltkzxjxkylxqakau.supabase.co';
const KEY = 'sb_publishable_WLC6h8BtnUPbLb77pVOrhA_th3CT1BR';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const tables = [
  'projects',
  'organizations',
  'organization_members',
  'organization_invites',
  'organization_projects',
  'organization_project_access',
];

// The three security-definer helpers were explicitly revoked from anon
// after Supabase's advisor flagged them; find_user_by_email is the one
// that would turn the public key into an account-enumeration oracle.
const rpcs = [
  ['find_user_by_email', { p_email: 'test@example.com' }],
  ['get_my_pending_invites', {}],
  ['is_org_member', { _org_id: '00000000-0000-0000-0000-000000000000' }],
  ['is_org_admin', { _org_id: '00000000-0000-0000-0000-000000000000' }],
  ['can_manage_org_project', { _project_id: '00000000-0000-0000-0000-000000000000' }],
];

let problems = 0;

for (const t of tables) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=5`, { headers: H });
  const body = await r.text();
  // A 200 with [] is correct RLS behaviour (policy matched no rows).
  // A 200 with rows is a leak.
  const leaked = r.ok && body.trim() !== '[]';
  if (leaked) problems++;
  console.log(
    `${leaked ? 'LEAK ' : 'ok   '} SELECT ${t.padEnd(30)} ${r.status} ${body.slice(0, 110)}`
  );
}

for (const [fn, args] of rpcs) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await r.text();
  const leaked = r.ok;
  if (leaked) problems++;
  console.log(
    `${leaked ? 'LEAK ' : 'ok   '} RPC    ${fn.padEnd(30)} ${r.status} ${body.slice(0, 110)}`
  );
}

const w = await fetch(`${URL}/rest/v1/organizations`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'rls-probe-expected-to-fail',
    created_by: '00000000-0000-0000-0000-000000000000',
  }),
});
const wb = await w.text();
if (w.ok) {
  problems++;
  console.log('LEAK  INSERT organizations       ', w.status, wb.slice(0, 200));
} else {
  console.log('ok    INSERT organizations refused', w.status, wb.slice(0, 130));
}

console.log(
  problems === 0
    ? '\nRLS OK — anonymous access refused on every table and RPC the app uses'
    : `\n${problems} ANONYMOUS ACCESS PROBLEM(S) — do not ship`
);
