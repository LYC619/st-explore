import { tr } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import type { Backdrop } from '@/play/gal/scene';
import type { StageMediaPool } from '@/play/media/pool';
import type { WorldMediaRepo } from '@/play/media/media-repo';
function AssetImage({ id, pool, repo, className }: { id: string; pool: StageMediaPool; repo: WorldMediaRepo; className: string }) {
  const [url, setUrl] = useState<string>(), [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, release: (() => void) | undefined; setUrl(undefined); setFailed(false);
    void repo.get(id).then(asset => { if (!alive) return; if (!asset) throw new Error(tr("素材缺失")); const handle = pool.acquire(asset); release = handle.release; setUrl(handle.url); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; release?.(); };
  }, [id, pool, repo]);
  return url && !failed ? <img className={className} src={url} alt="" onError={() => setFailed(true)} /> : null;
}
export function StageMedia({ background, backgroundAsset, portraitAsset, name, pool, repo }: { background: Backdrop; backgroundAsset?: string; portraitAsset?: string; name: string; pool: StageMediaPool; repo: WorldMediaRepo }) {
  return <div className="gal-media" aria-hidden="true"><img className="gal-background" src={`/play/backgrounds/${background}.webp`} alt="" />{backgroundAsset && <AssetImage id={backgroundAsset} className="gal-background" pool={pool} repo={repo} />}
    {portraitAsset ? <AssetImage id={portraitAsset} className="gal-portrait" pool={pool} repo={repo} /> : <div className="gal-presence"><span>{name[0]}</span><i /><small>{name}</small></div>}
    <div className="gal-gradient" /></div>;
}
