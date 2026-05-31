const addItemBtn = document.getElementById("add-item-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const cancelBtn = document.getElementById("cancel-btn");
const submitBtn = document.getElementById("submit-btn");
const itemInput = document.getElementById("item-input");
const itemsList = document.getElementById("items-list");

// Fetch and display items from the server
async function fetchAndDisplayItems() {
  try {
    const response = await fetch("/api/items");
    if (response.ok) {
      const items = await response.json();
      itemsList.innerHTML = ""; // Clear current list

      if (items.length === 0) {
        itemsList.innerHTML =
          '<li class="empty-message">No items added yet.</li>';
        return;
      }

      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item.name;
        itemsList.appendChild(li);
      });
    } else {
      console.error("Failed to fetch items");
      itemsList.innerHTML =
        '<li class="empty-message">Failed to load items.</li>';
    }
  } catch (error) {
    console.error("Error fetching items:", error);
    itemsList.innerHTML =
      '<li class="empty-message">Error connecting to server.</li>';
  }
}

// Open modal
addItemBtn.addEventListener("click", () => {
  modalBackdrop.classList.remove("hidden");
  itemInput.value = "";
  itemInput.focus();
});

// Close modal
cancelBtn.addEventListener("click", () => {
  modalBackdrop.classList.add("hidden");
});

// Handle submit
submitBtn.addEventListener("click", async () => {
  const name = itemInput.value.trim();
  if (!name) return;

  try {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: name }),
    });

    if (response.ok) {
      itemInput.value = ""; // Clear input on success
      modalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else {
      alert("Failed to add item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Load items when the page starts
fetchAndDisplayItems();
