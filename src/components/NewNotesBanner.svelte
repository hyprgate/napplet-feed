<script lang="ts">
  interface Props {
    count: number;
    onclick: () => void;
  }

  let { count, onclick }: Props = $props();
</script>

{#if count > 0}
  <button
    type="button"
    class="w-full sticky top-0 z-10 flex items-center justify-center gap-2 px-4 py-2 bg-accent-green/10 text-accent-green border-b border-accent-green/30 font-mono text-sm cursor-pointer hover:bg-accent-green/20 transition-colors"
    onclick={onclick}
    aria-live="polite"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 2H3v16h5v4l4-4h5l4-4V2z" />
    </svg>
    {count} new note{count === 1 ? '' : 's'}
  </button>
{/if}
