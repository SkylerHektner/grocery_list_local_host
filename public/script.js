const addItemBtn = document.getElementById("add-item-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const cancelBtn = document.getElementById("cancel-btn");
const submitBtn = document.getElementById("submit-btn");
const itemInput = document.getElementById("item-input");
const itemCategory = document.getElementById("item-category");
const itemsList = document.getElementById("items-list");

// Fetch and populate categories
async function fetchAndPopulateCategories() {
  try {
    const response = await fetch("/api/categories");
    if (response.ok) {
      const categories = await response.json();
      categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        itemCategory.appendChild(option);
      });
    } else {
      console.error("Failed to fetch categories");
    }
  } catch (error) {
    console.error("Error fetching categories:", error);
  }
}

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
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = item.name;

        const categorySpan = document.createElement("span");
        categorySpan.className = "category-tag";
        categorySpan.textContent = item.category;

        li.appendChild(nameSpan);
        li.appendChild(categorySpan);
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
  const category = itemCategory.value;

  if (!name || !category) {
    alert("Please enter a name and select a category.");
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
      itemInput.value = ""; // Clear input on success
      itemCategory.value = ""; // Clear category
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

// Load data when the page starts
fetchAndPopulateCategories();
fetchAndDisplayItems();
