let expenses = [];
let currentFilter = '';

// Initialize expenses page
async function initializeExpenses() {
    if (!firebase.auth().currentUser) return;
    
    try {
        await loadExpenses();
        setupEventListeners();
        updateSummary();
        updateDashboardExpenses();
    } catch (error) {
        console.error('Error initializing expenses:', error);
        showNotification('Error loading expenses', 'danger');
    }
}

// Load expenses from Firestore
async function loadExpenses() {
    const expensesList = document.getElementById('expensesList');
    // If not on expenses page, we might still be on dashboard needing data
    // but we only show skeleton if the list container exists
    if (expensesList) {
        expensesList.innerHTML = `
            <div class="skeleton-expense"></div>
            <div class="skeleton-expense"></div>
            <div class="skeleton-expense"></div>
        `;
    }
    
    const user = firebase.auth().currentUser;
    // Use onSnapshot for real-time updates (better UX)
    firebase.firestore()
        .collection('users')
        .doc(user.uid)
        .collection('expenses')
        .orderBy('date', 'desc')
        .onSnapshot(querySnapshot => {
            expenses = [];
            querySnapshot.forEach((doc) => {
                expenses.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            renderExpenses();
            updateSummary();
            updateDashboardExpenses(); // Also update dashboard if visible
        }, error => {
            console.error('Error listening to expenses:', error);
            showNotification('Error loading real-time expenses', 'danger');
        });
}

// Render expenses list
function renderExpenses() {
    const expensesList = document.getElementById('expensesList');
    if (!expensesList) return;
    
    if (expenses.length === 0) {
        expensesList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-receipt fa-3x mb-3"></i>
                <h4>No expenses yet</h4>
                <p>Add your first expense to get started</p>
            </div>
        `;
        return;
    }
    
    let filteredExpenses = expenses;
    if (currentFilter) {
        filteredExpenses = expenses.filter(expense => expense.category === currentFilter);
    }
    
    expensesList.innerHTML = filteredExpenses.map(expense => `
        <div class="expense-item" data-category="${expense.category}" data-id="${expense.id}">
            <div class="expense-info">
                <div class="expense-category">
                    <i class="${categoryIcons[expense.category] || categoryIcons.Other} me-2"></i>
                    ${expense.category}
                </div>
                <div class="expense-note">${expense.note || 'No description'}</div>
                <div class="expense-date">${formatDate(expense.date)}</div>
            </div>
            <div class="expense-amount" style="color: ${categoryColors[expense.category] || categoryColors.Other}">
                ${formatCurrency(expense.amount)}
            </div>
            <div class="action-buttons">
                <button class="btn btn-sm btn-outline-danger delete-expense" data-id="${expense.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    // Add delete event listeners
    document.querySelectorAll('.delete-expense').forEach(button => {
        // Remove existing listener to prevent stacking
        button.removeEventListener('click', handleDeleteExpense); 
        button.addEventListener('click', handleDeleteExpense);
    });
}

// Handle expense deletion
async function handleDeleteExpense(e) {
    const expenseId = e.currentTarget.getAttribute('data-id');
    const expenseItem = document.querySelector(`.expense-item[data-id="${expenseId}"]`);
    
    const confirmed = await showConfirmModal(
        'This will permanently delete the expense record. Are you sure?', 
        'Delete Expense'
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        expenseItem.classList.add('removing');
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const user = firebase.auth().currentUser;
        await firebase.firestore()
            .collection('users')
            .doc(user.uid)
            .collection('expenses')
            .doc(expenseId)
            .delete();
        
        showNotification('Expense deleted successfully', 'success');
    } catch (error) {
        console.error('Error deleting expense:', error);
        showNotification('Error deleting expense', 'danger');
    }
}

// Add new expense
async function addExpense(expenseData) {
    try {
        const user = firebase.auth().currentUser;
        const amount = parseFloat(expenseData.amount);

        await firebase.firestore()
            .collection('users')
            .doc(user.uid)
            .collection('expenses')
            .add({
                amount: amount,
                category: expenseData.category,
                note: expenseData.note,
                date: expenseData.date,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        
        showNotification('Expense added successfully', 'success');
        return true;
    } catch (error) {
        console.error('Error adding expense:', error);
        showNotification('Error adding expense', 'danger');
        return false;
    }
}

// Update summary statistics (Expenses Page)
function updateSummary() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const todayTotal = expenses
        .filter(expense => new Date(expense.date) >= today)
        .reduce((sum, expense) => sum + expense.amount, 0);
    
    const weekTotal = expenses
        .filter(expense => new Date(expense.date) >= weekAgo)
        .reduce((sum, expense) => sum + expense.amount, 0);
    
    const monthTotal = expenses
        .filter(expense => new Date(expense.date) >= monthStart)
        .reduce((sum, expense) => sum + expense.amount, 0);
    
    // Update DOM elements
    const todayElement = document.getElementById('todayTotal');
    const weekElement = document.getElementById('weekTotal');
    const monthElement = document.getElementById('monthTotal');
    
    if (todayElement) todayElement.textContent = formatCurrency(todayTotal);
    if (weekElement) weekElement.textContent = formatCurrency(weekTotal);
    if (monthElement) monthElement.textContent = formatCurrency(monthTotal);
}

// Update Dashboard Statistics (Dashboard Page)
async function updateDashboardExpenses() {
    const todaySpentEl = document.getElementById('todaySpent');
    const monthSpentEl = document.getElementById('monthSpent');
    const recentListEl = document.getElementById('recentExpenses');
    
    if (!todaySpentEl && !monthSpentEl && !recentListEl) return;

    const stats = await getSpendingStats();
    
    if (todaySpentEl) todaySpentEl.textContent = formatCurrency(stats.today);
    if (monthSpentEl) monthSpentEl.textContent = formatCurrency(stats.month);

    if (recentListEl) {
        const recentExpenses = await getRecentExpenses(5);
        if (recentExpenses.length === 0) {
            recentListEl.innerHTML = '<div class="text-muted text-center py-3">No recent expenses</div>';
        } else {
            recentListEl.innerHTML = recentExpenses.map(expense => `
                <div class="expense-item" data-category="${expense.category}">
                    <div class="expense-info">
                        <div class="expense-category">
                            <i class="${categoryIcons[expense.category] || categoryIcons.Other} me-2"></i>
                            ${expense.category}
                        </div>
                        <div class="expense-date">${formatDate(expense.date)}</div>
                    </div>
                    <div class="expense-amount" style="color: ${categoryColors[expense.category] || categoryColors.Other}">
                        ${formatCurrency(expense.amount)}
                    </div>
                </div>
            `).join('');
        }
    }
}

// Setup event listeners
function setupEventListeners() {
    const addExpenseForm = document.getElementById('addExpenseForm');
    if (addExpenseForm) {
        addExpenseForm.removeEventListener('submit', handleAddExpenseSubmit); 
        addExpenseForm.addEventListener('submit', handleAddExpenseSubmit);
    }
    
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.removeEventListener('change', handleCategoryFilterChange); 
        categoryFilter.addEventListener('change', handleCategoryFilterChange);
    }
    
    const expenseModal = document.getElementById('addExpenseModal');
    if (expenseModal) {
        expenseModal.addEventListener('show.bs.modal', () => {
            const form = document.getElementById('addExpenseForm');
            if (form) form.reset();
            const dateInput = document.getElementById('expenseDate');
            if (dateInput) dateInput.value = formatDateForInput(new Date());
        });
    }
}

async function handleAddExpenseSubmit(e) {
    e.preventDefault();
    const addExpenseForm = e.currentTarget;
    const saveBtn = document.getElementById('saveExpenseBtn');
    const modal = bootstrap.Modal.getInstance(document.getElementById('addExpenseModal'));
    
    saveBtn.classList.add('btn-loading');
    
    const formData = new FormData(addExpenseForm);
    const expenseData = {
        amount: formData.get('amount'),
        category: formData.get('category'),
        note: formData.get('note'),
        date: formData.get('date')
    };
    
    const success = await addExpense(expenseData);
    saveBtn.classList.remove('btn-loading');
    
    if (success) {
        addExpenseForm.reset();
        modal.hide();
    }
}

function handleCategoryFilterChange(e) {
    currentFilter = e.target.value;
    renderExpenses();
}

// Get expenses for dashboard
async function getRecentExpenses(limit = 5) {
    if (!firebase.auth().currentUser) return [];
    
    try {
        const user = firebase.auth().currentUser;
        const q = firebase.firestore()
            .collection('users')
            .doc(user.uid)
            .collection('expenses')
            .orderBy('date', 'desc')
            .limit(limit);
        
        const querySnapshot = await q.get();
        const recentExpenses = [];
        
        querySnapshot.forEach((doc) => {
            recentExpenses.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        return recentExpenses;
    } catch (error) {
        console.error('Error getting recent expenses:', error);
        return [];
    }
}

// Get spending statistics for dashboard
async function getSpendingStats() {
    if (!firebase.auth().currentUser) return { today: 0, month: 0 };
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    try {
        const user = firebase.auth().currentUser;
        const expensesQuery = firebase.firestore()
            .collection('users')
            .doc(user.uid)
            .collection('expenses')
            .where('date', '>=', monthStart.toISOString().split('T')[0]);
        
        const querySnapshot = await expensesQuery.get();
        let todaySpent = 0;
        let monthSpent = 0;
        
        querySnapshot.forEach((doc) => {
            const expense = doc.data();
            const expenseDateString = expense.date; 
            const todayDateString = today.toISOString().split('T')[0];
            
            if (expenseDateString === todayDateString) {
                todaySpent += expense.amount;
            }
            monthSpent += expense.amount;
        });
        
        return { today: todaySpent, month: monthSpent };
    } catch (error) {
        console.error('Error getting spending stats:', error);
        return { today: 0, month: 0 };
    }
}

// Listen for global currency updates from UI.js
window.addEventListener('currency-updated', () => {
    // Re-render expenses with new currency
    renderExpenses();
    updateSummary();
    updateDashboardExpenses();
});

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.includes('expenses.html') || window.location.pathname.includes('dashboard.html')) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                initializeExpenses();
            }
        });
    }
});
