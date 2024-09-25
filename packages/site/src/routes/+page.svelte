<script lang="ts">
  import type { PageData } from "./$types";
  import Chat from "./Chat.svelte";
  import JoinForm from "./JoinForm.svelte";

  let {
    data,
  }: {
    data: PageData;
  } = $props();
</script>

{#if data.node}
  <Chat node={data.node} />
{:else}
  <JoinForm />
{/if}
