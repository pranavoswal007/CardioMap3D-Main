import { ShieldAlert } from 'lucide-react';
import { CANONICAL_DISCLAIMER } from '../constants/disclaimer';

export function DisclaimerBanner() {
  return (
    <div
      data-testid="canonical-disclaimer"
      className="fixed bottom-0 left-0 right-0 z-50 w-full bg-slate-950/95 backdrop-blur border-t border-slate-800 px-4 py-2.5 shadow-2xl"
    >
      <div className="max-w-7xl mx-auto flex items-center gap-2.5 text-xs text-amber-300/90 leading-tight">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="flex-1 font-medium">{CANONICAL_DISCLAIMER}</p>
      </div>
    </div>
  );
}
