const addNameBtn = document.getElementById("add-name-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const cancelBtn = document.getElementById("cancel-btn");
const submitBtn = document.getElementById("submit-btn");
const nameInput = document.getElementById("name-input");
const namesList = document.getElementById("names-list");

// Fetch and display names from the server
async function fetchAndDisplayNames() {
  try {
    const response = await fetch("/api/names");
    if (response.ok) {
      const names = await response.json();
      namesList.innerHTML = ""; // Clear current list

      if (names.length === 0) {
        namesList.innerHTML =
          '<li class="empty-message">No names added yet.</li>';
        return;
      }

      names.forEach((name) => {
        const li = document.createElement("li");
        li.textContent = name;
        namesList.appendChild(li);
      });
    } else {
      console.error("Failed to fetch names");
      namesList.innerHTML =
        '<li class="empty-message">Failed to load names.</li>';
    }
  } catch (error) {
    console.error("Error fetching names:", error);
    namesList.innerHTML =
      '<li class="empty-message">Error connecting to server.</li>';
  }
}

// Open modal
addNameBtn.addEventListener("click", () => {
  modalBackdrop.classList.remove("hidden");
  nameInput.value = "";
  nameInput.focus();
});

// Close modal
cancelBtn.addEventListener("click", () => {
  modalBackdrop.classList.add("hidden");
});

// Handle submit
submitBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const response = await fetch("/api/names", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: name }),
    });

    if (response.ok) {
      nameInput.value = ""; // Clear input on success
      modalBackdrop.classList.add("hidden");
      await fetchAndDisplayNames(); // Refresh the list
    } else {
      alert("Failed to add name.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Load names when the page starts
fetchAndDisplayNames();
