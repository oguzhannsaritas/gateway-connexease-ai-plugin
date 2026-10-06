const COMPONENT_TYPES = new Set(['HEADER', 'BODY', 'FOOTER', 'BUTTONS', 'LIMITED_TIME_OFFER']);
const BUTTON_TYPES = new Set(['PHONE_NUMBER', 'REQUEST_CONTACT_INFO', 'QUICK_REPLY', 'URL', 'COPY_CODE', 'OTP']);
const MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);
const PARAMETER_KEYS = new Set(['headerText', 'headerMedia', 'body', 'buttons']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertTextValues(values, name) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error(`${name} must be a list of non-empty text values`);
  }
  return values;
}

function assertExpectedValues(component, values, name, expected) {
  if (expected === 0 && /\{\{\s*\d+\s*\}\}/.test(component.text ?? '')) {
    throw new Error(`${name} has placeholders but no usable parameter metadata; send it from the panel`);
  }
  if (values.length !== expected) throw new Error(`${name} requires ${expected} value(s), got ${values.length}`);
}

/** Match the core sandbox builder's supported template components before asking for a send confirmation. */
export function validateTemplateParameters(template, input = {}) {
  if (!isRecord(input) || Object.keys(input).some((key) => !PARAMETER_KEYS.has(key))) {
    throw new Error('Unsupported template parameters');
  }
  const headerText = assertTextValues(input.headerText, 'headerText');
  const body = assertTextValues(input.body, 'body');
  const buttons = input.buttons === undefined ? [] : input.buttons;
  if (!Array.isArray(buttons)) throw new Error('buttons must be a list');

  let headerMedia;
  if (input.headerMedia !== undefined) {
    const media = input.headerMedia;
    if (!isRecord(media) || !MEDIA_TYPES.has(media.type) || Object.keys(media).some((key) => !['type', 'link', 'id', 'filename'].includes(key))) {
      throw new Error('Unsupported headerMedia parameter');
    }
    if (typeof media.link !== 'string' && typeof media.id !== 'string') {
      throw new Error('headerMedia requires a link or id');
    }
    if (media.link !== undefined) {
      let url;
      try { url = new URL(media.link); } catch { throw new Error('headerMedia link must be an HTTPS URL'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('headerMedia link must be an HTTPS URL');
    }
    if (media.id !== undefined && (typeof media.id !== 'string' || !media.id.trim())) throw new Error('headerMedia id is invalid');
    if (media.filename !== undefined && (typeof media.filename !== 'string' || !media.filename.trim())) throw new Error('headerMedia filename is invalid');
    headerMedia = { type: media.type, ...(media.link === undefined ? {} : { link: media.link }), ...(media.id === undefined ? {} : { id: media.id }), ...(media.filename === undefined ? {} : { filename: media.filename }) };
  }

  const providedButtons = new Map();
  for (const entry of buttons) {
    if (!isRecord(entry) || !Number.isInteger(entry.index) || entry.index < 0 || !['URL', 'COPY_CODE', 'QUICK_REPLY'].includes(entry.subType) || typeof entry.value !== 'string' || !entry.value.trim() || Object.keys(entry).some((key) => !['index', 'subType', 'value'].includes(key))) {
      throw new Error('Invalid button parameter');
    }
    if (providedButtons.has(entry.index)) throw new Error('Duplicate button parameter index');
    providedButtons.set(entry.index, { index: entry.index, subType: entry.subType, value: entry.value });
  }

  let headerSeen = false;
  let bodySeen = false;
  const expectedButtonIndexes = new Set();
  for (const component of template.components ?? []) {
    if (!isRecord(component)) throw new Error('Template component data is invalid');
    if (!COMPONENT_TYPES.has(component.type)) throw new Error(`Template component ${component.type} is not supported by sandbox sends`);
    if (component.type === 'HEADER') {
      headerSeen = true;
      if (component.format === 'TEXT') {
        assertExpectedValues(component, headerText, 'headerText', component.example?.headerText?.length ?? 0);
        if (headerMedia) throw new Error('Text header does not accept headerMedia');
      } else if (MEDIA_TYPES.has(component.format)) {
        if (headerText.length) throw new Error('Media header does not accept headerText');
        const required = Boolean(component.example?.headerHandle?.length || component.example?.headerUrl?.length);
        if (required !== Boolean(headerMedia)) throw new Error(`headerMedia ${required ? 'is required' : 'is not expected'}`);
        if (headerMedia && headerMedia.type !== component.format) throw new Error(`headerMedia must have type ${component.format}`);
      } else if (component.format === 'LOCATION') {
        if (headerText.length || headerMedia) throw new Error('Location header does not accept parameters');
      } else {
        throw new Error(`Template header format ${component.format ?? 'unknown'} is not supported by sandbox sends`);
      }
    }
    if (component.type === 'BODY') {
      bodySeen = true;
      assertExpectedValues(component, body, 'body', component.example?.bodyText?.[0]?.length ?? 0);
    }
    if (component.type === 'BUTTONS') {
      for (const [index, button] of (component.buttons ?? []).entries()) {
        if (!isRecord(button)) throw new Error('Template button data is invalid');
        if (!BUTTON_TYPES.has(button.type)) throw new Error(`Template button ${button.type} is not supported by sandbox sends`);
        const provided = providedButtons.get(index);
        if (provided) expectedButtonIndexes.add(index);
        if (['PHONE_NUMBER', 'REQUEST_CONTACT_INFO'].includes(button.type) && provided) throw new Error(`Static button ${index} does not accept parameters`);
        const expectedSubtype = button.type === 'OTP' ? 'URL' : button.type;
        if (provided && provided.subType !== expectedSubtype) throw new Error(`Button ${index} requires subType ${expectedSubtype}`);
        const hasExample = Array.isArray(button.example) ? button.example.length > 0 : Boolean(button.example);
        const needsValue = button.type === 'URL' ? hasExample : ['COPY_CODE', 'OTP'].includes(button.type);
        const authFallback = template.category === 'AUTHENTICATION' && body.length > 0;
        if (needsValue && !provided && !authFallback) throw new Error(`Button ${index} requires a value`);
        if (button.type === 'URL' && !needsValue && provided) throw new Error(`Static URL button ${index} does not accept parameters`);
      }
    }
  }
  if (!headerSeen && (headerText.length || headerMedia)) throw new Error('Template has no header parameters');
  if (!bodySeen && body.length) throw new Error('Template has no body parameters');
  if ([...providedButtons.keys()].some((index) => !expectedButtonIndexes.has(index))) throw new Error('Button parameter index is not in the template');

  return {
    ...(headerText.length ? { headerText } : {}),
    ...(headerMedia ? { headerMedia } : {}),
    ...(body.length ? { body } : {}),
    ...(providedButtons.size ? { buttons: [...providedButtons.values()] } : {}),
  };
}
