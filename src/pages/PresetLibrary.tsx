import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { PresetCatalog } from '@/components/preset/PresetCatalog';

export default function PresetLibrary() {
  const [params] = useSearchParams();
  return <AppLayout><PresetCatalog mode={params.get('mode') === 'select' ? 'select' : 'manage'} /></AppLayout>;
}
