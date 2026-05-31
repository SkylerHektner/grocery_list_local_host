// DOM Elements for Items
const newItemBtn = document.getElementById("new-item-btn");
const newItemModalBackdrop = document.getElementById("new-item-modal-backdrop");
const newItemCancelBtn = document.getElementById("new-item-cancel-btn");
const newItemSubmitBtn = document.getElementById("new-item-submit-btn");
const newItemInput = document.getElementById("item-input");
const newItemCategory = document.getElementById("item-category");
const itemsList = document.getElementById("items-list");

// edit item
const editItemModalBackdrop = document.getElementById(
  "edit-item-modal-backdrop",
);
const editItemCancelBtn = document.getElementById("edit-item-cancel-btn");
const editItemSubmitBtn = document.getElementById("edit-item-submit-btn");
const editItemInput = document.getElementById("edit-item-input");
const editItemCategory = document.getElementById("edit-item-category");

// delete item
const deleteItemModalBackdrop = document.getElementById(
  "delete-item-modal-backdrop",
);
const deleteItemCancelBtn = document.getElementById("delete-item-cancel-btn");
const deleteItemSubmitBtn = document.getElementById("delete-item-submit-btn");
const deleteItemNameDisplay = document.getElementById(
  "delete-item-name-display",
);

export let currentItems = [];
let editItemTargetName = "";
let deleteItemTargetName = "";

export async function fetchAndPopulateCategories() {
  try {
    const response = await fetch("/api/categories");
    if (response.ok) {
      const categories = await response.json();
      categories.forEach((category) => {
        // Add to main modal
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        newItemCategory.appendChild(option);

        // Add to edit modal
        const editOption = document.createElement("option");
        editOption.value = category;
        editOption.textContent = category;
        editItemCategory.appendChild(editOption);
      });
    } else {
      console.error("Failed to fetch categories");
    }
  } catch (error) {
    console.error("Error fetching categories:", error);
  }
}

export async function fetchAndDisplayItems() {
  try {
    const response = await fetch("/api/items");
    if (response.ok) {
      const items = await response.json();
      currentItems = items; // Store for duplicate checking
      itemsList.innerHTML = ""; // Clear current list

      if (items.length === 0) {
        itemsList.innerHTML =
          '<li class="empty-message">No items added yet.</li>';
        return;
      }

      // Sort items by category, then by name
      items.sort((a, b) => {
        if (a.category === b.category) {
          return a.name.localeCompare(b.name);
        }
        return a.category.localeCompare(b.category);
      });

      let currentCategory = null;

      items.forEach((item) => {
        if (item.category !== currentCategory) {
          const categoryHeader = document.createElement("li");
          categoryHeader.className = "category-header";
          categoryHeader.textContent = item.category;
          categoryHeader.style.marginTop =
            currentCategory === null ? "0" : "1rem";
          itemsList.appendChild(categoryHeader);
          currentCategory = item.category;
        }

        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";

        // Make items draggable
        li.draggable = true;
        li.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", item.name);
        });

        const nameSpan = document.createElement("span");
        nameSpan.textContent = item.name;

        const infoDiv = document.createElement("div");
        infoDiv.style.display = "flex";
        infoDiv.style.alignItems = "center";
        infoDiv.style.gap = "0.5rem";
        infoDiv.appendChild(nameSpan);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "item-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "icon-btn";
        editBtn.textContent = "✏️";
        editBtn.title = "Edit Item";
        editBtn.addEventListener("click", () => {
          editItemTargetName = item.name;
          editItemInput.value = item.name;
          editItemCategory.value = item.category;
          editItemModalBackdrop.classList.remove("hidden");
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "icon-btn";
        deleteBtn.textContent = "🗑️";
        deleteBtn.title = "Delete Item";
        deleteBtn.addEventListener("click", () => {
          deleteItemTargetName = item.name;
          deleteItemNameDisplay.textContent = item.name;
          deleteItemModalBackdrop.classList.remove("hidden");
        });

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);

        li.appendChild(infoDiv);
        li.appendChild(actionsDiv);
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
newItemBtn.addEventListener("click", () => {
  newItemModalBackdrop.classList.remove("hidden");
  newItemInput.value = "";
  newItemInput.focus();
});

// Close modal
newItemCancelBtn.addEventListener("click", () => {
  newItemModalBackdrop.classList.add("hidden");
});

// Handle submit
newItemSubmitBtn.addEventListener("click", async () => {
  const name = newItemInput.value.trim();
  const category = newItemCategory.value;

  if (!name || !category) {
    alert("Please enter a name and select a category.");
    return;
  }

  // Check for duplicates
  const isDuplicate = currentItems.some(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );

  if (isDuplicate) {
    alert(`The item "${name}" already exists!`);
    return;
  }

  try {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: name, category: category }),
    });

    if (response.ok) {
      newItemInput.value = ""; // Clear input on success
      newItemCategory.value = ""; // Clear category
      newItemModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else if (response.status === 409) {
      const msg = await response.text();
      alert(msg);
    } else {
      alert("Failed to add item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Edit Handlers
editItemCancelBtn.addEventListener("click", () => {
  editItemModalBackdrop.classList.add("hidden");
});

editItemSubmitBtn.addEventListener("click", async () => {
  const name = editItemInput.value.trim();
  const category = editItemCategory.value;

  if (!name || !category) {
    alert("Please enter a name and select a category.");
    return;
  }

  // Check for duplicates if the name changed
  if (name.toLowerCase() !== editItemTargetName.toLowerCase()) {
    const isDuplicate = currentItems.some(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );

    if (isDuplicate) {
      alert(`The item "${name}" is already on your list!`);
      return;
    }
  }

  try {
    const response = await fetch(
      `/api/items/${encodeURIComponent(editItemTargetName)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name, category: category }),
      },
    );

    if (response.ok) {
      editItemModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else {
      alert("Failed to update item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Delete Handlers
deleteItemCancelBtn.addEventListener("click", () => {
  deleteItemModalBackdrop.classList.add("hidden");
});

deleteItemSubmitBtn.addEventListener("click", async () => {
  try {
    const response = await fetch(
      `/api/items/${encodeURIComponent(deleteItemTargetName)}`,
      {
        method: "DELETE",
      },
    );

    if (response.ok) {
      deleteItemModalBackdrop.classList.add("hidden");
      await fetchAndDisplayItems(); // Refresh the list
    } else {
      alert("Failed to delete item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});
