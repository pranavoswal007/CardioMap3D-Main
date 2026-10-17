import { FileText, Heart, ShieldAlert, ExternalLink } from 'lucide-react';
import heartAttributionText from '../../public/models/ATTRIBUTION.txt?raw';
import { CANONICAL_DISCLAIMER } from '../constants/disclaimer';

export function AboutTab() {
  return (
    <div className="space-y-6 text-slate-100 max-w-4xl mx-auto">
      {/* Header and Safety Notice */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-3">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="w-6 h-6 text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">About CardioMap 3D & Safety Guidelines</h2>
        </div>
        <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg text-xs text-amber-200 leading-relaxed font-medium">
          {CANONICAL_DISCLAIMER}
        </div>
      </div>

      {/* Dataset Attribution */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">Clinical Dataset Provenance</h3>
        </div>
        <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
          <p>
            CardioMap 3D was trained and validated on the <strong>Z-Alizadeh Sani extension dataset</strong> (N=303 patients, 55 features).
          </p>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li>
              <strong className="text-slate-300">UCI Repository ID:</strong> 411
            </li>
            <li>
              <strong className="text-slate-300">Authors:</strong> Roohallah Alizadehsani, Mahdi Roshanzamir, Zahra Alizadeh Sani
            </li>
            <li>
              <strong className="text-slate-300">License:</strong> Creative Commons Attribution 4.0 International (CC BY 4.0)
            </li>
            <li>
              <strong className="text-slate-300">DOI:</strong>{' '}
              <a
                href="https://doi.org/10.24432/C5461K"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:underline inline-flex items-center gap-1"
              >
                10.24432/C5461K
                <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          </ul>
        </div>
      </div>

      {/* 3D Heart Model Asset Attribution */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-3">
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-rose-400" />
          <h3 className="text-sm font-semibold text-white">3D Anatomical Heart Model Attribution</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Heart model by Hannah Newey, University of Dundee (CAHID), CC BY-NC-SA 4.0.
          The verbatim attribution statement is embedded below:
        </p>

        {/* Verbatim ATTRIBUTION.txt imported via Vite ?raw */}
        <div
          data-testid="heart-attribution-text"
          className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed overflow-x-auto"
        >
          {heartAttributionText}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-slate-400">
          <div>
            License document:{' '}
            <a
              href="/models/heart_LICENSE.txt"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline inline-flex items-center gap-1 font-mono"
            >
              heart_LICENSE.txt
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="text-[11px] text-amber-300/90 font-medium">
            Note: ShareAlike (CC BY-NC-SA 4.0) applies to the 3D anatomical heart mesh model asset only, not to the software codebase or ML pipeline.
          </div>
        </div>
      </div>
    </div>
  );
}
