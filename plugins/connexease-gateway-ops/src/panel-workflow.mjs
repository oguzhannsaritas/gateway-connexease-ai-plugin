/** Prepare an allowlisted account mutation, ask for native confirmation, then recheck before writing. */
export async function performPanelAction(gateway, confirm, action, args) {
  const prepared = await gateway.preparePanelAction(action, args);
  if (prepared.status === 'unchanged') return prepared;
  const approved = await confirm({ kind: 'panel_action', preview: { action, details: prepared.preview } });
  if (!approved) return { status: 'cancelled', action, changed: false };
  return gateway.executePanelAction(prepared);
}

export async function createApiKey(gateway, confirm, discloseSecret, args) {
  const prepared = await gateway.preparePanelAction('create_api_key', args);
  const approved = await confirm({ kind: 'panel_action', preview: { action: 'create_api_key', details: prepared.preview } });
  if (!approved) return { status: 'cancelled', action: 'create_api_key', changed: false };
  const created = await gateway.executePanelAction(prepared);
  // The secret is intentionally never returned through MCP, even if the local dialog fails.
  let secretShownInNativeDialog = false;
  try {
    secretShownInNativeDialog = await discloseSecret({ label: `Gateway API key ${created.metadata.name}`, secret: created.key });
  } catch {
    // Key creation already succeeded; a failed local dialog must not imply creation failed.
  }
  return {
    status: 'created', action: 'create_api_key', metadata: created.metadata,
    secretShownInNativeDialog,
    ...(secretShownInNativeDialog ? {} : { warning: 'The key was created, but local secret disclosure was not confirmed. Check Gateway panel; do not create another key blindly.' }),
  };
}

export async function createOrganizationSecret(gateway, confirm, discloseSecret, args) {
  const prepared = await gateway.preparePanelAction('create_organization_secret', args);
  const approved = await confirm({ kind: 'panel_action', preview: { action: 'create_organization_secret', details: prepared.preview } });
  if (!approved) return { status: 'cancelled', action: 'create_organization_secret', changed: false };
  const created = await gateway.executePanelAction(prepared);
  let secretShownInNativeDialog = false;
  if (created.secret) {
    try {
      secretShownInNativeDialog = await discloseSecret({ label: `Gateway organization ${created.metadata.type} key ${created.metadata.name}`, secret: created.secret });
    } catch {
      // Creation already succeeded; never retry it just because local disclosure failed.
    }
  }
  return {
    status: 'created', action: 'create_organization_secret', metadata: created.metadata,
    secretShownInNativeDialog,
    ...(secretShownInNativeDialog ? {} : { warning: 'The key was created, but its plaintext was not confirmed locally. Check Gateway panel; do not create another key blindly.' }),
  };
}
