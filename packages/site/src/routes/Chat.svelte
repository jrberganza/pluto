<script lang="ts">
  import type { PageData } from "./$types";

  let { node: pNode }: { node: NonNullable<PageData["node"]> } = $props();

  let node = $state(pNode);

  let newRoomPassword = $state("");
  let newMessage = $state("");

  let selectedRoom: string | null = $state(null);

  $effect(() => {
    const interval = setInterval(async () => {
      node = await (await fetch("/api/node" + location.search)).json();
    }, 500);
    return () => clearInterval(interval);
  });
</script>

<ul>
  {#each node.rooms as room}
    <li>
      <button
        type="button"
        onclick={() => {
          if (node.joinedRooms.includes(room)) {
            selectedRoom = room;
            return;
          }
          const password = prompt("Password");
          if (password === null) return;
          fetch(`/api/join` + location.search, {
            method: "POST",
            body: JSON.stringify({
              room,
              password: password,
            }),
          });
        }}
        >{#if node.joinedRooms.includes(room)}
          <b>{room}</b>
        {:else}
          {room}
        {/if}</button
      >
    </li>
  {/each}
</ul>
<input type="text" placeholder="Password" bind:value={newRoomPassword} />
<button
  type="button"
  onclick={async () => {
    const res = await fetch(`/api/rooms` + location.search, {
      method: "POST",
      body: JSON.stringify({ password: newRoomPassword }),
    });
    if (!res.ok) return;
    newRoomPassword = "";
  }}>Create Group</button
>
{#if selectedRoom !== null}
  <div>
    {selectedRoom}
    <ul>
      {#each node.messages[selectedRoom] as message}
        <li>
          {node.authorNames[message.author] ?? message.author}: {message.text}
        </li>
      {/each}
    </ul>
    <input type="text" placeholder="Write here..." bind:value={newMessage} />
    <button
      type="button"
      onclick={async () => {
        const res = await fetch("/api/messages" + location.search, {
          method: "POST",
          body: JSON.stringify({ room: selectedRoom, message: newMessage }),
        });
        if (!res.ok) return;
        newMessage = "";
      }}>Send</button
    >
  </div>
{/if}
