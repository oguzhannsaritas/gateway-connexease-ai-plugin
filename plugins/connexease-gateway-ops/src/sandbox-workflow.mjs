export async function addSandboxTestNumber(gateway, confirm, args) {
  const prepared = await gateway.prepareSandboxTestNumber(args);
  if (prepared.status === 'already_exists') return prepared;
  const approved = await confirm({ kind: 'add_test_number', preview: prepared.preview });
  if (!approved) return { status: 'cancelled', changed: false };
  return gateway.createSandboxTestNumber(prepared);
}

export async function sendSandboxText(gateway, confirm, args) {
  const prepared = await gateway.prepareSandboxText(args);
  const approved = await confirm({ kind: 'send_sandbox_text', preview: prepared.preview });
  if (!approved) return { status: 'cancelled', sent: false };
  return gateway.sendSandboxText(prepared);
}

export async function sendSandboxTemplate(gateway, confirm, args) {
  const prepared = await gateway.prepareSandboxTemplate(args);
  const approved = await confirm({ kind: 'send_sandbox_template', preview: prepared.preview });
  if (!approved) return { status: 'cancelled', sent: false };
  return gateway.sendSandboxTemplate(prepared);
}
