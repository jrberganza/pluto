<script lang="ts">
  let path = $state("");
  let name = $state("");
</script>

<form
  onsubmit={(e) => {
    e.preventDefault();
    location.search = `?keypath=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
  }}
>
  <input type="text" placeholder="Path" bind:value={path} />
  <input type="text" placeholder="Name" bind:value={name} />
  <button type="submit">Start Node</button>
</form>
