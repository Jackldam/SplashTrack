import { CAPABILITIES, requireAuthContext } from '@/rbac/index';
import { readTranslationStore } from '@/shared/translation-store';
import { TranslationEditor } from './translation-editor';

export default async function TranslationManagementPage() {
  await requireAuthContext({ capability: CAPABILITIES.organizationAdmin });
  const store = await readTranslationStore();

  return <TranslationEditor store={store} />;
}
