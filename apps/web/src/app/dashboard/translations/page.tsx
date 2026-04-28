import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { readTranslationStore } from '@/lib/translation-store';
import { TranslationEditor } from './translation-editor';

export default async function TranslationManagementPage() {
  await requireAuthContext({ capability: CAPABILITIES.organizationAdmin });
  const store = await readTranslationStore();

  return <TranslationEditor store={store} />;
}
