// Shared neo-brutalist button recipes for the Copilot sidebar.
// Border-2 + hard offset shadow + lift on hover, matching the app's design system.
export const BTN_LIFT =
  "transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900";
export const BTN_PRIMARY = `inline-flex items-center gap-1.5 rounded-xl border-2 border-black bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus-visible:ring-indigo-500 ${BTN_LIFT}`;
export const BTN_SECONDARY = `inline-flex items-center gap-1.5 rounded-xl border-2 border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-bold text-neutral-700 hover:bg-neutral-200 focus-visible:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 ${BTN_LIFT}`;
