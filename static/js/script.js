document.addEventListener('DOMContentLoaded', function() {
    // Application variables
    let currentSection = 'dashboard';
    let notifications = [];
    let socket = io();
    let users = [];
    
    // Initialize application
    function init() {
        loadSection(currentSection);
        setupEventListeners();
        setupSocket();
        fetchInitialData();
    }
    
    // Load the specified section
    function loadSection(section) {
        currentSection = section;
        const template = document.getElementById(`${section}Template`);
        if (!template) {
            document.getElementById('mainContent').innerHTML = `
                <div class="card">
                    <h2>${section} Section Under Development</h2>
                    <p>This section is not currently available and will be added in future updates</p>
                </div>
            `;
            return;
        }
        
        const content = template.content.cloneNode(true);
        document.getElementById('mainContent').innerHTML = '';
        document.getElementById('mainContent').appendChild(content);
        
        // Initialize section-specific events
        initSectionEvents(section);
    }
    
    // Initialize global event listeners
    function setupEventListeners() {
        // Toggle sidebar
        document.getElementById('toggleSidebar').addEventListener('click', function() {
            document.getElementById('sidebar').classList.toggle('collapsed');
            this.querySelector('i').classList.toggle('fa-chevron-right');
            this.querySelector('i').classList.toggle('fa-chevron-left');
        });
        
        // Navigation between sections
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                const section = this.getAttribute('data-section');
                loadSection(section);
            });
        });
        
        // Notifications panel
        document.getElementById('notificationBell').addEventListener('click', function() {
            document.getElementById('notificationPanel').classList.toggle('open');
        });
        
        document.getElementById('closeNotifications').addEventListener('click', function() {
            document.getElementById('notificationPanel').classList.remove('open');
        });
    }
    
    // Initialize section-specific events
    function initSectionEvents(section) {
        if (section === 'dashboard') {
            initDashboard();
        } else if (section === 'scanner') {
            initScanner();
        } else if (section === 'inbox') {
            initInbox();
        }
    }
    
    // Initialize dashboard
    function initDashboard() {
        // Update statistics
        updateDashboardStats();
        
        // Add document button
        document.getElementById('addDocumentBtn')?.addEventListener('click', function() {
            loadSection('scanner');
            document.querySelector('[data-section="scanner"]').classList.add('active');
        });
        
        // Document filtering
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                const filter = this.getAttribute('data-filter');
                filterDocuments(filter);
            });
        });
        
        // Fetch and display documents
        fetchDocuments();
    }
    
    // Initialize scanner section
    function initScanner() {
        // Camera control variables
        let cameraStream = null;
        let capturedImageData = null;

        // Open camera modal
        function openCameraModal() {
            const modal = document.getElementById('cameraModal');
            modal.style.display = 'block';
            
            // Reinitialize event listeners
            document.querySelector('.close-modal').addEventListener('click', closeCameraModal);
            document.getElementById('captureBtn').addEventListener('click', captureImage);
            document.getElementById('retryBtn').addEventListener('click', retryCapture);
            document.getElementById('processImageBtn').addEventListener('click', processImageWithTesseract);
            document.getElementById('useTextBtn').addEventListener('click', useExtractedText);
            
            startCamera();
        }

        function closeCameraModal() {
            const modal = document.getElementById('cameraModal');
            modal.style.display = 'none';
            stopCamera();
            
            // Reset elements
            document.getElementById('imagePreview').style.display = 'none';
            document.getElementById('imagePreview').innerHTML = '';
            document.getElementById('ocrResult').style.display = 'none';
            document.getElementById('captureBtn').style.display = 'block';
            document.getElementById('retryBtn').style.display = 'none';
            document.getElementById('processImageBtn').style.display = 'none';
            document.getElementById('useTextBtn').style.display = 'none';
            
            capturedImageData = null;
        }

        function startCamera() {
            const video = document.getElementById('cameraFeed');
            
            // Stop any previous camera stream
            if (cameraStream) {
                cameraStream.getTracks().forEach(track => track.stop());
            }
            
            // Add browser support check
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert('Browser does not support camera access');
                return;
            }
            
            // Request camera permission properly
            navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            })
            .then(function(stream) {
                cameraStream = stream;
                video.srcObject = stream;
                video.play().catch(e => {
                    console.error('Video play error:', e);
                    alert('Failed to start camera. Please check permissions.');
                });
            })
            .catch(function(error) {
                console.error('Camera access error:', error);
                alert('Cannot access camera. Please ensure permissions are granted.');
            });
        }

        function stopCamera() {
            if (cameraStream) {
                cameraStream.getTracks().forEach(track => {
                    track.stop();
                });
                cameraStream = null;
            }
        }

        function captureImage() {
            const video = document.getElementById('cameraFeed');
            const canvas = document.createElement('canvas');
            const preview = document.getElementById('imagePreview');
            
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Display captured image
            const imageDataURL = canvas.toDataURL('image/jpeg');
            preview.innerHTML = `<img src="${imageDataURL}" alt="Captured Image" style="max-width:100%;">`;
            preview.style.display = 'block';
            capturedImageData = imageDataURL;
            
            // Show retry and process buttons
            document.getElementById('captureBtn').style.display = 'none';
            document.getElementById('retryBtn').style.display = 'block';
            document.getElementById('processImageBtn').style.display = 'block';
        }

        function retryCapture() {
            document.getElementById('imagePreview').style.display = 'none';
            document.getElementById('imagePreview').innerHTML = '';
            document.getElementById('ocrResult').style.display = 'none';
            document.getElementById('captureBtn').style.display = 'block';
            document.getElementById('retryBtn').style.display = 'none';
            document.getElementById('processImageBtn').style.display = 'none';
            document.getElementById('useTextBtn').style.display = 'none';
            capturedImageData = null;
            
            // Restart camera
            startCamera();
        }

        function processImageWithTesseract() {
            if (!capturedImageData) return;
            
            const processBtn = document.getElementById('processImageBtn');
            const resultArea = document.getElementById('extractedTextFromImage');
            
            // Show loading indicator
            resultArea.value = 'Analyzing image...';
            document.getElementById('ocrResult').style.display = 'block';
            
            processBtn.disabled = true;
            processBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
            
            // Extract text using Tesseract.js
            Tesseract.recognize(
                capturedImageData,
                'eng+deu', // Languages: English and German
                { 
                    logger: m => console.log(m),
                    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
                }
            ).then(({ data: { text } }) => {
                resultArea.value = text;
                processBtn.disabled = false;
                processBtn.innerHTML = '<i class="fas fa-search"></i> Analyze Image';
                document.getElementById('useTextBtn').style.display = 'block';
            }).catch(error => {
                console.error('Error during OCR:', error);
                resultArea.value = '❌ Failed to analyze image. Please try again.';
                processBtn.disabled = false;
                processBtn.innerHTML = '<i class="fas fa-search"></i> Analyze Image';
            });
        }

        function useExtractedText() {
            const extractedText = document.getElementById('extractedTextFromImage').value;
            if (extractedText && extractedText.trim() !== '') {
                document.getElementById('extractedText').textContent = extractedText;
                document.getElementById('textPreviewCard').style.display = 'block';
                document.getElementById('processDocumentBtn').disabled = false;
                closeCameraModal();
                
                // Create virtual file from extracted text
                const fileName = `captured_image_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
                const file = new File([extractedText], fileName, { type: 'text/plain' });
                
                // Update file input element
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                document.getElementById('fileInput').files = dataTransfer.files;
            } else {
                alert('No text to use. Please analyze an image containing text.');
            }
        }
        
        // File selection
        document.getElementById('scannerBox')?.addEventListener('click', function() {
            document.getElementById('fileInput').click();
        });
        
        document.getElementById('fileInput')?.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                document.getElementById('processDocumentBtn').disabled = false;
                
                const file = e.target.files[0];
                const ext = file.name.split('.').pop().toLowerCase();
                
                // Reset text preview
                document.getElementById('extractedText').textContent = '';
                document.getElementById('textPreviewCard').style.display = 'none';
                
                // Special handling for images and PDF
                if (['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
                    document.getElementById('extractedText').textContent = 
                        'Analyzing file... This may take a few seconds';
                    document.getElementById('textPreviewCard').style.display = 'block';
                    
                    // Attempt preliminary text extraction
                    const formData = new FormData();
                    formData.append('file', file);
                    
                    fetch('/upload?preview=true', {
                        method: 'POST',
                        body: formData
                    })
                    .then(response => response.text())
                    .then(text => {
                        document.getElementById('extractedText').textContent = text;
                    })
                    .catch(error => {
                        document.getElementById('extractedText').textContent = 
                            `❌ Failed to analyze file: ${error.message}`;
                    });
                }
                else if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
                    const reader = new FileReader();
                    reader.onload = function(event) {
                        document.getElementById('extractedText').textContent = event.target.result;
                        document.getElementById('textPreviewCard').style.display = 'block';
                    };
                    reader.readAsText(file);
                }
                else {
                    document.getElementById('extractedText').textContent = 
                        `File uploaded: ${file.name}\nText will be processed after analysis...`;
                    document.getElementById('textPreviewCard').style.display = 'block';
                }
            }
        });
        
        // Process document
        document.getElementById('processDocumentBtn')?.addEventListener('click', function() {
            const fileInput = document.getElementById('fileInput');
            if (fileInput.files.length === 0) return;
            
            const file = fileInput.files[0];
            const formData = new FormData();
            formData.append('file', file);
            
            fetch('/upload', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.message) {
                    showToast('Document processing started successfully', 'success');
                } else {
                    showToast('Error occurred during document processing', 'error');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('Error connecting to server', 'error');
            });
        });
        
        // Fetch and display processing documents
        fetchProcessingDocuments();
        
        // Add event listener for camera button
        document.getElementById('cameraScanBtn')?.addEventListener('click', function() {
            openCameraModal();
        });
    }
    
    // Initialize Socket.IO connection
    function setupSocket() {
        // When receiving a new document
        socket.on('new_document', function(doc) {
            addDocumentToInbox(doc);
            updateDashboardStats();
            showToast(`New document added: ${doc.name}`, 'info');
        });
        
        // When document is updated
        socket.on('document_updated', function(doc) {
            updateDocumentInUI(doc);
            updateDashboardStats();
        });
        
        // When document processing starts
        socket.on('processing_started', function(processingDoc) {
            addProcessingDocument(processingDoc);
        });
        
        // When processing progress updates
        socket.on('processing_update', function(processingDoc) {
            updateProcessingDocument(processingDoc);
        });
        
        // When processing completes
        socket.on('processing_completed', function(processingDoc) {
            removeProcessingDocument(processingDoc.id);
        });
        
        // When receiving a notification
        socket.on('notification', function(notification) {
            addNotification(notification);
        });
        
        // When client connects
        socket.on('connect', function() {
            console.log('Connected to server');
        });
        
        // Initial documents list
        socket.on('documents_list', function(docs) {
            documents = docs;
            renderDocuments(docs);
        });
        
        // Initial processing list
        socket.on('processing_list', function(processingDocs) {
            processingDocs.forEach(doc => addProcessingDocument(doc));
        });
    }
    
    // Fetch initial data
    function fetchInitialData() {
        // Fetch users
        fetch('/users')
            .then(response => response.json())
            .then(data => {
                users = data;
            });
    }
    
    // Fetch documents
    function fetchDocuments() {
        fetch('/documents')
            .then(response => response.json())
            .then(data => {
                renderDocuments(data);
            });
    }
    
    // Fetch processing documents
    function fetchProcessingDocuments() {
        fetch('/processing')
            .then(response => response.json())
            .then(data => {
                data.forEach(doc => addProcessingDocument(doc));
            });
    }
    
    // Display documents in inbox
    function renderDocuments(docs) {
        const inboxGrid = document.getElementById('inboxGrid');
        if (!inboxGrid) return;
        
        inboxGrid.innerHTML = '';
        
        docs.forEach(doc => {
            const user = users.find(u => u.id === doc.assigned_to);
            const priorityClass = getPriorityClass(doc.priority);
            
            const card = document.createElement('div');
            card.className = 'document-card';
            card.dataset.id = doc.id;
            card.innerHTML = `
                <div class="document-card-header">
                    <h3>${doc.name}</h3>
                    <span class="priority ${priorityClass}">${doc.priority}</span>
                </div>
                <div class="document-card-body">
                    <p><strong>Type:</strong> ${doc.type}</p>
                    <p><strong>Sender:</strong> ${doc.sender}</p>
                    <p><strong>Date:</strong> ${doc.received_at}</p>
                    <p><strong>Assignee:</strong> ${user ? user.name : 'Unassigned'}</p>
                </div>
            `;
            
            card.addEventListener('click', function() {
                showDocumentDetails(doc.id);
            });
            
            inboxGrid.appendChild(card);
        });
    }
    
    // Add new document to UI
    function addDocumentToInbox(doc) {
        const inboxGrid = document.getElementById('inboxGrid');
        if (!inboxGrid) return;
        
        const user = users.find(u => u.id === doc.assigned_to);
        const priorityClass = getPriorityClass(doc.priority);
        
        const card = document.createElement('div');
        card.className = 'document-card';
        card.dataset.id = doc.id;
        card.innerHTML = `
            <div class="document-card-header">
                <h3>${doc.name}</h3>
                <span class="priority ${priorityClass}">${doc.priority}</span>
            </div>
            <div class="document-card-body">
                <p><strong>Type:</strong> ${doc.type}</p>
                <p><strong>Sender:</strong> ${doc.sender}</p>
                <p><strong>Date:</strong> ${doc.received_at}</p>
                <p><strong>Assignee:</strong> ${user ? user.name : 'Unassigned'}</p>
            </div>
        `;
        
        card.addEventListener('click', function() {
            showDocumentDetails(doc.id);
        });
        
        inboxGrid.prepend(card);
    }
    
    // Update document in UI
    function updateDocumentInUI(doc) {
        const card = document.querySelector(`.document-card[data-id="${doc.id}"]`);
        if (card) {
            const priorityClass = getPriorityClass(doc.priority);
            const user = users.find(u => u.id === doc.assigned_to);
            
            card.querySelector('.priority').className = `priority ${priorityClass}`;
            card.querySelector('.priority').textContent = doc.priority;
            
            const body = card.querySelector('.document-card-body');
            body.innerHTML = `
                <p><strong>Type:</strong> ${doc.type}</p>
                <p><strong>Sender:</strong> ${doc.sender}</p>
                <p><strong>Date:</strong> ${doc.received_at}</p>
                <p><strong>Assignee:</strong> ${user ? user.name : 'Unassigned'}</p>
                <p><strong>Status:</strong> ${doc.status}</p>
            `;
        }
        
        // If document details are open
        if (document.getElementById('documentTitle')?.textContent === doc.name) {
            document.getElementById('documentStatus').textContent = doc.status;
        }
    }
    
    // Add processing document
    function addProcessingDocument(processingDoc) {
        const container = document.getElementById('processingDocuments');
        if (!container) return;
        
        const card = document.createElement('div');
        card.className = 'processing-card';
        card.dataset.id = processingDoc.id;
        card.innerHTML = `
            <div class="processing-header">
                <span class="processing-name">${processingDoc.name}</span>
                <span class="processing-status">${processingDoc.status}</span>
            </div>
            <div class="progress-container">
                <div class="progress-header">
                    <span>Progress</span>
                    <span>${processingDoc.progress}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${processingDoc.progress}%"></div>
                </div>
            </div>
            <div class="processing-footer">
                <small>Started at: ${processingDoc.started_at}</small>
            </div>
        `;
        
        container.prepend(card);
    }
    
    // Update processing document
    function updateProcessingDocument(processingDoc) {
        const card = document.querySelector(`.processing-card[data-id="${processingDoc.id}"]`);
        if (card) {
            card.querySelector('.processing-status').textContent = processingDoc.status;
            card.querySelector('.progress-fill').style.width = `${processingDoc.progress}%`;
            card.querySelector('.progress-header span:last-child').textContent = `${processingDoc.progress}%`;
        }
    }
    
    // Remove processing document
    function removeProcessingDocument(id) {
        const card = document.querySelector(`.processing-card[data-id="${id}"]`);
        if (card) {
            card.remove();
        }
    }
    
    // Show document details
    function showDocumentDetails(docId) {
        fetch(`/documents/${docId}`)
            .then(response => response.json())
            .then(doc => {
                if (doc.error) {
                    showToast(doc.error, 'error');
                    return;
                }
                
                const user = users.find(u => u.id === doc.assigned_to);
                
                const template = document.getElementById('documentDetailsTemplate');
                const content = template.content.cloneNode(true);
                document.getElementById('mainContent').innerHTML = '';
                document.getElementById('mainContent').appendChild(content);
                
                // Populate data
                document.getElementById('documentTitle').textContent = doc.name;
                document.getElementById('documentType').textContent = doc.type;
                document.getElementById('documentSender').textContent = doc.sender;
                document.getElementById('documentReceived').textContent = doc.received_at;
                document.getElementById('documentDue').textContent = doc.due_date;
                document.getElementById('documentStatus').textContent = doc.status;
                
                const prioritySpan = document.getElementById('documentPriority');
                prioritySpan.textContent = doc.priority;
                prioritySpan.className = `document-priority ${doc.priority}`;
                
                document.getElementById('documentAssignee').textContent = user ? user.name : 'Unassigned';
                
                // Document preview
                const preview = document.getElementById('documentPreview');
                const ext = doc.name.split('.').pop().toLowerCase();
                
                // Add loading indicator
                preview.innerHTML = '<p>Loading document preview...</p>';
                
                // Advanced preview strategy
                if (doc.text_extracted) {
                    fetch(`/document_content/${doc.id}`)
                        .then(response => response.text())
                        .then(text => {
                            preview.innerHTML = `
                                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; max-height: 500px; overflow: auto;">
                                    <pre style="white-space: pre-wrap; font-family: 'Tajawal', sans-serif;">${text}</pre>
                                </div>
                            `;
                        })
                        .catch(error => {
                            preview.innerHTML = `<p>Error loading content: ${error.message}</p>`;
                        });
                } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
                    preview.innerHTML = `
                        <img src="/uploads/${doc.name}" alt="${doc.name}" 
                             style="max-width: 100%; border-radius: 8px;">
                        <p class="text-center mt-3">No text extracted from this image</p>
                    `;
                } else if (ext === 'pdf') {
                    preview.innerHTML = `
                        <embed src="/uploads/${doc.name}" width="100%" height="500px" type="application/pdf">
                        <p class="text-center mt-3">Text extraction not available for this file</p>
                    `;
                } else {
                    preview.innerHTML = `
                        <p>Cannot preview this file type. 
                           <a href="/uploads/${doc.name}" download class="btn btn-sm btn-primary">
                               <i class="fas fa-download"></i> Download File
                           </a>
                        </p>
                    `;
                }
                
                // Update status
                document.getElementById('updateStatusBtn').addEventListener('click', function() {
                    const newStatus = document.getElementById('statusSelect').value;
                    socket.emit('update_document_status', {
                        doc_id: docId,
                        status: newStatus
                    });
                    showToast('Document status updated', 'success');
                });
                
                // Back to inbox
                document.getElementById('backToInbox').addEventListener('click', function() {
                    loadSection('dashboard');
                    document.querySelector('[data-section="dashboard"]').classList.add('active');
                });
            });
    }
    
    // Filter documents
    function filterDocuments(filter) {
        // In a real app, filtered docs would come from server
        // Here we'll just highlight urgent documents
        document.querySelectorAll('.document-card').forEach(card => {
            if (filter === 'all') {
                card.style.display = 'block';
            } else if (filter === 'urgent') {
                const priority = card.querySelector('.priority').textContent;
                card.style.display = priority === 'Urgent' ? 'block' : 'none';
            } else {
                // Filter by type
                const type = card.querySelector('.document-card-body p:first-child').textContent;
                if (type.includes(filter)) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            }
        });
    }
    
    // Update dashboard statistics
    function updateDashboardStats() {
        fetch('/documents')
            .then(response => response.json())
            .then(docs => {
                // Get elements
                const totalEl = document.getElementById('totalDocuments');
                const pendingEl = document.getElementById('pendingDocuments');
                const urgentEl = document.getElementById('urgentDocuments');
                const completedEl = document.getElementById('completedDocuments');

                // If elements don't exist, do nothing to avoid errors
                if (!totalEl || !pendingEl || !urgentEl || !completedEl) return;

                // Update if elements exist
                totalEl.textContent = docs.length;
                pendingEl.textContent = docs.filter(d => d.status === 'Pending Review').length;
                urgentEl.textContent = docs.filter(d => d.priority === 'Urgent').length;
                completedEl.textContent = docs.filter(d => d.status === 'Completed').length;
            })
            .catch(error => {
                console.error('Error fetching document statistics:', error);
            });
    }

    // Add new notification
    function addNotification(notification) {
        notifications.unshift(notification);
        updateNotificationCount();
        renderNotifications();
        
        // Show immediate notification
        showToast(notification.message, notification.type);
    }
    
    // Update notification count
    function updateNotificationCount() {
        document.getElementById('notificationCount').textContent = notifications.length;
        document.getElementById('notificationTotal').textContent = notifications.length;
        
        // Update sidebar counter
        const urgentCount = notifications.filter(n => n.type === 'urgent').length;
        document.getElementById('urgentCount').textContent = urgentCount;
    }
    
    // Display notifications
    function renderNotifications() {
        const container = document.getElementById('notificationsContainer');
        if (!container) return;
        
        container.innerHTML = '';
        
        notifications.forEach(notif => {
            const notifElement = document.createElement('div');
            notifElement.className = 'notification-item';
            notifElement.innerHTML = `
                <i class="fas fa-${notif.type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
                <div class="notification-content">
                    <h4>${notif.title}</h4>
                    <p>${notif.message}</p>
                    <div class="timestamp">${notif.timestamp}</div>
                </div>
            `;
            container.appendChild(notifElement);
        });
    }
    
    // Show toast message
    function showToast(message, type) {
        // Implement actual toast display in reality
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
    
    // Get priority class
    function getPriorityClass(priority) {
        switch (priority) {
            case 'Urgent': return 'urgent';
            case 'Medium': return 'medium';
            case 'Low': return 'low';
            default: return '';
        }
    }
    
    // Start application
    init();
});

// Initialize inbox section
function initInbox() {
  // Fetch documents
  fetchDocuments();
  
  // Search documents
  document.getElementById('searchDocuments')?.addEventListener('input', function(e) {
    filterInboxDocuments();
  });
  
  // Sorting and filtering
  document.getElementById('sortBy')?.addEventListener('change', function() {
    sortInboxDocuments();
  });
  
  document.getElementById('filterBy')?.addEventListener('change', function() {
    filterInboxDocuments();
  });
}

// Sort documents
function sortInboxDocuments() {
  const sortBy = document.getElementById('sortBy').value;
  const container = document.getElementById('inboxGrid');
  
  if (!container) return;
  
  const items = Array.from(container.children);
  
  items.sort((a, b) => {
    const aDate = new Date(a.dataset.date);
    const bDate = new Date(b.dataset.date);
    
    if (sortBy === 'newest') {
      return bDate - aDate;
    } else if (sortBy === 'oldest') {
      return aDate - bDate;
    } else if (sortBy === 'priority') {
      const aPriority = a.dataset.priority;
      const bPriority = b.dataset.priority;
      
      const priorityOrder = {'Urgent': 1, 'Medium': 2, 'Low': 3};
      return priorityOrder[aPriority] - priorityOrder[bPriority];
    }
    return 0;
  });
  
  // Reorder elements
  items.forEach(item => container.appendChild(item));
}

// Filter documents
function filterInboxDocuments() {
  const filterBy = document.getElementById('filterBy').value;
  const searchTerm = document.getElementById('searchDocuments').value.toLowerCase();
  const items = document.querySelectorAll('.inbox-item');
  
  let visibleCount = 0;
  let urgentCount = 0;
  let pendingCount = 0;
  
  items.forEach(item => {
    const type = item.dataset.type;
    const name = item.dataset.name.toLowerCase();
    const sender = item.dataset.sender.toLowerCase();
    const content = item.dataset.content.toLowerCase();
    const priority = item.dataset.priority;
    const status = item.dataset.status;
    
    const matchesFilter = 
      (filterBy === 'all') ||
      (filterBy === 'urgent' && priority === 'Urgent') ||
      (filterBy === 'invoices' && type === 'Invoice') ||
      (filterBy === 'contracts' && type === 'Contract') ||
      (filterBy === 'violations' && type === 'Violation');
    
    const matchesSearch = 
      !searchTerm ||
      name.includes(searchTerm) ||
      sender.includes(searchTerm) ||
      content.includes(searchTerm);
    
    if (matchesFilter && matchesSearch) {
      item.style.display = 'block';
      visibleCount++;
      
      if (priority === 'Urgent') urgentCount++;
      if (status !== 'Completed') pendingCount++;
    } else {
      item.style.display = 'none';
    }
  });
  
  // Update statistics
  document.getElementById('totalInbox').textContent = visibleCount;
  document.getElementById('urgentInbox').textContent = urgentCount;
  document.getElementById('pendingInbox').textContent = pendingCount;
}

// Display documents in inbox
function renderInboxDocuments(docs) {
  const inboxGrid = document.getElementById('inboxGrid');
  if (!inboxGrid) return;
  
  inboxGrid.innerHTML = '';
  
  docs.forEach(doc => {
    const user = users.find(u => u.id === doc.assigned_to);
    const priorityClass = doc.priority === 'Urgent' ? 'urgent' : '';
    
    const item = document.createElement('div');
    item.className = `inbox-item ${priorityClass}`;
    item.dataset.id = doc.id;
    item.dataset.date = doc.received_at;
    item.dataset.priority = doc.priority;
    item.dataset.type = doc.type;
    item.dataset.status = doc.status;
    item.dataset.name = doc.name;
    item.dataset.sender = doc.sender;
    item.dataset.content = doc.content;
    
    item.innerHTML = `
      <div class="inbox-item-header">
        <h3>${doc.name}</h3>
        <span class="inbox-item-type">${doc.type}</span>
      </div>
      <div class="inbox-item-body">
        <div class="inbox-item-info">
          <p><strong>Sender:</strong> ${doc.sender}</p>
          <p><strong>Priority:</strong> ${doc.priority}</p>
          <p><strong>Status:</strong> ${doc.status}</p>
          <p><strong>Assignee:</strong> ${user ? user.name : 'Unassigned'}</p>
        </div>
        <div class="inbox-item-actions">
          <span class="inbox-item-date">
            <i class="far fa-clock"></i> ${doc.received_at}
          </span>
          <button class="inbox-item-preview">
            <i class="far fa-eye"></i> Preview
          </button>
        </div>
      </div>
    `;
    
    // Add document preview event
    item.querySelector('.inbox-item-preview').addEventListener('click', function(e) {
      e.stopPropagation();
      showDocumentDetails(doc.id);
    });
    
    // Add document details open event
    item.addEventListener('click', function() {
      showDocumentDetails(doc.id);
    });
    
    inboxGrid.appendChild(item);
  });
  
  // Update statistics after rendering
  filterInboxDocuments();
}

// Update fetchDocuments to work with inbox
function fetchDocuments() {
  fetch('/documents')
    .then(response => response.json())
    .then(data => {
      if (currentSection === 'dashboard') {
        renderDocuments(data);
      } else if (currentSection === 'inbox') {
        renderInboxDocuments(data);
      }
      updateDashboardStats();
    });
}

// Update loadSection to load inbox
function loadSection(section) {
  currentSection = section;
  const template = document.getElementById(`${section}Template`);
  
  if (!template) {
    // Show development message only for undeveloped sections
    const unavailableSections = ['urgent', 'archive', 'reports', 'settings', 'integrations'];
    if (unavailableSections.includes(section)) {
      document.getElementById('mainContent').innerHTML = `
        <div class="card">
          <h2>${section} Section Under Development</h2>
          <p>This section is not currently available and will be added in future updates</p>
        </div>
      `;
      return;
    }
  }
  
  const content = template.content.cloneNode(true);
  document.getElementById('mainContent').innerHTML = '';
  document.getElementById('mainContent').appendChild(content);
  
  // Initialize section-specific events
  initSectionEvents(section);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "someAction") {
    // Immediate response
    sendResponse({ data: "immediate response" });
    // Don't return true
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  doAsyncTask()
    .then(result => {
      sendResponse({ success: true, data: result });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });
  return true;
});