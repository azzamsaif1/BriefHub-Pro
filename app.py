from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from datetime import datetime, timedelta
import os
import time
import uuid
from werkzeug.utils import secure_filename
import threading
import pytesseract
from PIL import Image, ImageEnhance, ImageFilter
import fitz
from langdetect import detect
import requests
from transformers import pipeline
import easyocr  # Added EasyOCR library

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'pdf', 'txt', 'html'}
socketio = SocketIO(app, async_mode='threading')

# API settings
OCR_API_URL = "https://api.example.com/ocr"
OCR_API_KEY = "your_api_key_here"

# Summary settings
SUMMARY_CACHE = {}
SUMMARY_MODEL = "facebook/bart-large-cnn"

# Ensure upload directory exists
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Configure Tesseract path (modify for your system)
# pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

# Initial data
documents = []
processing_docs = []
users = [
    {"id": 1, "name": "Ahmed Mohamed", "role": "Finance Manager"},
    {"id": 2, "name": "Sara Abdullah", "role": "HR Manager"},
    {"id": 3, "name": "Khalid Hassan", "role": "Operations Manager"}
]

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

# Text extraction using EasyOCR for German/English only
def easyocr_extract(file_path):
    """Extract text using EasyOCR for German/English"""
    try:
        # Configuration for German/English
        reader = easyocr.Reader(
            ['en', 'de'],  # English/German only
            gpu=False,
            model_storage_directory='easyocr_models',
            download_enabled=True
        )
        
        # Advanced settings for European languages
        result = reader.readtext(
            file_path,
            detail=0,
            paragraph=True,
            contrast_ths=0.3,
            text_threshold=0.7,
            link_threshold=0.4,
            mag_ratio=1.5,
            decoder='beamsearch',
            batch_size=4
        )
        return '\n'.join(result)
    except Exception as e:
        print(f"EasyOCR extraction error: {str(e)}")
        return ""

# Text extraction using Tesseract for German/English only
def pytesseract_extract(file_path):
    """Extract text using Tesseract for German/English"""
    try:
        image = Image.open(file_path)
        
        # Image enhancements for European text
        image = image.convert('L')  # Grayscale
        
        # Enhance contrast for Latin characters
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.5)
        
        # Noise reduction
        image = image.filter(ImageFilter.MedianFilter(3))
        image = image.filter(ImageFilter.SMOOTH_MORE)
        
        # Scale image for better recognition
        if max(image.width, image.height) < 1500:
            scale_factor = 2000 // max(image.width, image.height)
            new_width = image.width * scale_factor
            new_height = image.height * scale_factor
            image = image.resize((new_width, new_height), Image.LANCZOS)
        
        # Sharpen characters
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(2.0)
        
        # Try different PSM modes for European languages
        configs = [
            '--psm 3 -c preserve_interword_spaces=1 --oem 3',  # Fully automatic
            '--psm 6 -c preserve_interword_spaces=1 --oem 3',  # Single text block
            '--psm 11 -c preserve_interword_spaces=1 --oem 3',  # Raw text
            '--psm 4 -c preserve_interword_spaces=1 --oem 3'   # Single column
        ]
        
        # Focus on German/English languages
        languages = [
            'eng',      # English only
            'deu',      # German only
            'eng+deu'   # English + German
        ]
        
        best_text = ""
        for lang in languages:
            for config in configs:
                text = pytesseract.image_to_string(
                    image, 
                    lang=lang,
                    config=config
                )
                # Select best result based on text length
                if len(text) > len(best_text):
                    best_text = text
        
        return best_text
    
    except Exception as e:
        print(f"Tesseract extraction error: {str(e)}")
        return ""

# Text extraction for all file types
def extract_text(file_path):
    ext = file_path.split('.')[-1].lower()
    
    try:
        if ext in ['jpg', 'jpeg', 'png']:
            # Try external API first
            try:
                files = {'image': open(file_path, 'rb')}
                headers = {'Authorization': f'Bearer {OCR_API_KEY}'}
                response = requests.post(OCR_API_URL, files=files, headers=headers, timeout=10)
                
                if response.status_code == 200:
                    result = response.json()
                    return result.get('text', '')
            except Exception as api_error:
                print(f"API call error: {str(api_error)}")
            
            # Use enhanced Tesseract
            tesseract_text = pytesseract_extract(file_path)
            if tesseract_text.strip():
                return tesseract_text
                
            # Use EasyOCR as fallback
            return easyocr_extract(file_path)
            
        elif ext == 'pdf':
            # Improved PDF text extraction
            text = ""
            pdf = fitz.open(file_path)
            for page in pdf:
                text += page.get_text("text", sort=True)
            return text
            
        elif ext in ['txt', 'html']:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
    except Exception as e:
        print(f"Text extraction error: {str(e)}")
        return ""
    
    return ""

# Generate text summary
def summarize_text(text):
    """Summarize text using AI model"""
    if not text.strip():
        return "No text to summarize"
    
    # Skip summarization for short texts
    words = text.split()
    if len(words) < 50:
        return text
    
    # Check cache
    cache_key = hash(text)
    if cache_key in SUMMARY_CACHE:
        return SUMMARY_CACHE[cache_key]
    
    try:
        # Use summarization model
        summarizer = pipeline("summarization", model=SUMMARY_MODEL)
        summary = summarizer(
            text,
            max_length=150,
            min_length=30,
            do_sample=False
        )
        result = summary[0]['summary_text']
        
        # Cache result
        SUMMARY_CACHE[cache_key] = result
        return result
    except Exception as e:
        print(f"Summary generation error: {str(e)}")
        # Return first 150 words as fallback
        return ' '.join(words[:150])

# Analyze text to determine type and priority
def analyze_text(text):
    if not text.strip():
        return 'General Document', text, 'Medium'
    
    text_lower = text.lower()
    
    try:
        # Detect text language
        lang = detect(text)
        
        # Language-specific configuration
        if lang == 'de':  # German
            # Determine document type
            doc_type = 'Allgemein'
            if 'rechnung' in text_lower:
                doc_type = 'Rechnung'
            elif 'vertrag' in text_lower:
                doc_type = 'Vertrag'
            elif 'strafe' in text_lower or 'bußgeld' in text_lower:
                doc_type = 'Strafe'
            elif 'zertifikat' in text_lower:
                doc_type = 'Zertifikat'
            elif 'antrag' in text_lower:
                doc_type = 'Antrag'
            
            # Determine priority
            priority = 'Mittel'
            if 'dringend' in text_lower or 'dringende' in text_lower:
                priority = 'Dringend'
            elif 'wichtig' in text_lower:
                priority = 'Mittel'
            elif 'normal' in text_lower:
                priority = 'Niedrig'
            
            # Map to English for application
            doc_type_map = {
                'Rechnung': 'Invoice',
                'Vertrag': 'Contract',
                'Strafe': 'Violation',
                'Zertifikat': 'Certificate',
                'Antrag': 'Request',
                'Allgemein': 'General Document'
            }
            priority_map = {
                'Dringend': 'Urgent',
                'Mittel': 'Medium',
                'Niedrig': 'Low'
            }
            
            return doc_type_map.get(doc_type, doc_type), text, priority_map.get(priority, priority)
            
        elif lang == 'en':  # English
            # Determine document type
            doc_type = 'General'
            if 'invoice' in text_lower:
                doc_type = 'Invoice'
            elif 'agreement' in text_lower or 'contract' in text_lower:
                doc_type = 'Contract'
            elif 'fine' in text_lower or 'penalty' in text_lower:
                doc_type = 'Violation'
            elif 'certificate' in text_lower:
                doc_type = 'Certificate'
            elif 'request' in text_lower or 'application' in text_lower:
                doc_type = 'Request'
            
            # Determine priority
            priority = 'Medium'
            if 'urgent' in text_lower:
                priority = 'Urgent'
            elif 'important' in text_lower:
                priority = 'Medium'
            elif 'normal' in text_lower:
                priority = 'Low'
            
            return doc_type, text, priority
            
        else:  # Arabic and other languages
            return analyze_arabic_text(text)
            
    except Exception as e:
        print(f"Language detection error: {str(e)}")
        return analyze_arabic_text(text)

# Analyze text for Arabic
def analyze_arabic_text(text):
    text_lower = text.lower()
    
    # Determine document type
    doc_type = 'General Document'
    if 'فاتورة' in text_lower or 'invoice' in text_lower or 'rechnung' in text_lower:
        doc_type = 'Invoice'
    elif 'عقد' in text_lower or 'agreement' in text_lower or 'vertrag' in text_lower:
        doc_type = 'Contract'
    elif 'غرامة' in text_lower or 'مخالفة' in text_lower or 'fine' in text_lower or 'strafe' in text_lower:
        doc_type = 'Violation'
    elif 'شهادة' in text_lower or 'certificate' in text_lower or 'zertifikat' in text_lower:
        doc_type = 'Certificate'
    elif 'طلب' in text_lower or 'request' in text_lower or 'antrag' in text_lower:
        doc_type = 'Request'
    
    # Determine priority
    priority = 'Medium'
    if 'إنذار' in text_lower or 'تحذير' in text_lower or 'urgent' in text_lower or 'dringend' in text_lower:
        priority = 'Urgent'
    elif 'هام' in text_lower or 'important' in text_lower or 'wichtig' in text_lower:
        priority = 'Medium'
    elif 'عادي' in text_lower or 'normal' in text_lower:
        priority = 'Low'
    
    return doc_type, text, priority

# Extract sender from text
def extract_sender(text):
    text_lower = text.lower()
    sender = 'Unknown Sender'
    
    # Search for sender patterns
    patterns = {
        'الكهرباء|electricity|strom': 'Electricity Company',
        'المياه|water|wasser': 'Water Company',
        'البلدية|municipality|gemeinde': 'Municipality',
        'الضرائب|ضريبي|tax|steuer': 'Tax Authority',
        'البنك|bank': 'National Bank',
        'المرور|traffic|verkehr': 'Traffic Department',
        'الصحة|health|gesundheit': 'Health Ministry',
        'التعليم|education|bildung': 'Education Ministry'
    }
    
    for pattern, name in patterns.items():
        if any(keyword in text_lower for keyword in pattern.split('|')):
            sender = name
            break
    
    # Try extracting sender from text
    sender_keywords = ['من', 'sender', 'absender', 'المرسل', 'von']
    for line in text.split('\n'):
        for keyword in sender_keywords:
            if keyword in line.lower():
                parts = line.split(':')
                if len(parts) > 1:
                    sender = parts[1].strip()
                    break
                else:
                    parts = line.split(keyword)
                    if len(parts) > 1:
                        sender = parts[1].strip()
                        break
    
    return sender

# Assign user based on sender
def assign_user_by_sender(sender):
    sender_lower = sender.lower()
    if 'مالية' in sender_lower or 'البنك' in sender_lower or 'ضريبي' in sender_lower:
        return next((u['id'] for u in users if 'مالي' in u['role']), users[0]['id'])
    elif 'الموارد' in sender_lower or 'البشرية' in sender_lower or 'موظف' in sender_lower:
        return next((u['id'] for u in users if 'موارد' in u['role']), users[0]['id'])
    elif 'العمليات' in sender_lower or 'المرور' in sender_lower or 'مرور' in sender_lower:
        return next((u['id'] for u in users if 'العمليات' in u['role']), users[0]['id'])
    return users[0]['id']

# Document processing
def process_document(file_path, callback):
    try:
        text = extract_text(file_path)
        summary = summarize_text(text)  # Generate summary
        doc_type, full_text, priority = analyze_text(text)
        sender = extract_sender(text)
        assigned_to = assign_user_by_sender(sender)
        due_date = datetime.now() + timedelta(days=7)

        result = {
            'id': str(uuid.uuid4()),
            'name': os.path.basename(file_path),
            'type': doc_type,
            'sender': sender,
            'due_date': due_date.strftime('%d.%m.%Y'),
            'received_at': datetime.now().strftime('%d.%m.%Y %H:%M'),
            'file_path': file_path,
            'status': 'New',
            'priority': priority,
            'assigned_to': assigned_to,
            'content': full_text,
            'summary': summary,
            'text_extracted': bool(text.strip())
        }
        callback(result)
    except Exception as e:
        print("Processing error:", e)

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/documents', methods=['GET'])
def get_documents():
    return jsonify(documents)

@app.route('/documents/<doc_id>', methods=['GET'])
def get_document(doc_id):
    doc = next((d for d in documents if d['id'] == doc_id), None)
    return jsonify(doc) if doc else (jsonify({'error': 'Document not found'}), 404)

@app.route('/upload', methods=['POST'])
def upload_document():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        # Preview request
        if request.args.get('preview') == 'true':
            try:
                text = extract_text(file_path)
                return text
            except Exception as e:
                return f"Preview error: {str(e)}", 400

        processing_doc = {
            'id': str(uuid.uuid4()),
            'name': filename,
            'status': 'Processing',
            'progress': 0,
            'started_at': datetime.now().strftime('%d.%m.%Y %H:%M')
        }
        processing_docs.append(processing_doc)
        socketio.emit('processing_started', processing_doc)

        def processing_callback(result):
            processing_docs[:] = [d for d in processing_docs if d['id'] != processing_doc['id']]
            documents.append(result)
            socketio.emit('processing_completed', processing_doc)
            socketio.emit('new_document', result)
            
            # Send success notification
            socketio.emit('notification', {
                'id': str(uuid.uuid4()),
                'title': 'Document Analysis',
                'message': f"Document {result['name']} processed successfully",
                'type': 'success',
                'timestamp': datetime.now().strftime('%d.%m.%Y %H:%M')
            })

        def simulate_processing():
            for i in range(1, 101):
                time.sleep(0.03)
                processing_doc['progress'] = i
                socketio.emit('processing_update', processing_doc)
            process_document(file_path, processing_callback)

        threading.Thread(target=simulate_processing).start()
        return jsonify({
            'message': 'Processing document...',
            'processing_id': processing_doc['id'],
            'filename': filename
        })

    return jsonify({'error': 'File type not allowed'}), 400

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    try:
        text = extract_text(file_path)
        if not text.strip():
            return "❌ Failed to extract text. File may be corrupt or unsupported.", 400
        
        return text, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except Exception as e:
        return f"File read error: {str(e)}", 500

@app.route('/users', methods=['GET'])
def get_users():
    return jsonify(users)

@app.route('/processing', methods=['GET'])
def get_processing_docs():
    return jsonify(processing_docs)

@app.route('/document_content/<doc_id>', methods=['GET'])
def get_document_content(doc_id):
    doc = next((d for d in documents if d['id'] == doc_id), None)
    if doc:
        # Try stored content first
        if doc.get('content'):
            return doc['content'], 200, {'Content-Type': 'text/plain; charset=utf-8'}
        
        # Extract from file if needed
        try:
            text = extract_text(doc['file_path'])
            return text, 200, {'Content-Type': 'text/plain; charset=utf-8'}
        except Exception as e:
            return f"Text extraction error: {str(e)}", 500
    else:
        return jsonify({'error': 'Document not found'}), 404

# New route for summarization
@app.route('/summarize/<doc_id>', methods=['GET'])
def summarize_document(doc_id):
    doc = next((d for d in documents if d['id'] == doc_id), None)
    if not doc:
        return jsonify({'error': 'Document not found'}), 404
    
    # Use document's full text
    text = doc.get('content', '')
    summary = summarize_text(text)
    
    return jsonify({'summary': summary})

# New route for retrying extraction
@app.route('/retry_extraction/<doc_id>', methods=['POST'])
def retry_extraction(doc_id):
    doc = next((d for d in documents if d['id'] == doc_id), None)
    if not doc:
        return jsonify({'success': False, 'error': 'Document not found'}), 404
    
    try:
        # Re-extract text
        text = extract_text(doc['file_path'])
        
        # Update document
        doc['content'] = text
        doc['text_extracted'] = bool(text.strip())
        
        # Re-analyze if text exists
        if doc['text_extracted']:
            doc['summary'] = summarize_text(text)
            doc_type, _, priority = analyze_text(text)
            doc['type'] = doc_type
            doc['priority'] = priority
            doc['sender'] = extract_sender(text)
            doc['assigned_to'] = assign_user_by_sender(doc['sender'])
        
        socketio.emit('document_updated', doc, broadcast=True)
        return jsonify({'success': True})
    
    except Exception as e:
        print(f"Re-extraction error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Socket.IO
@socketio.on('connect')
def handle_connect():
    emit('documents_list', documents)
    emit('processing_list', processing_docs)

@socketio.on('update_document_status')
def handle_update_document_status(data):
    doc_id = data.get('doc_id')
    new_status = data.get('status')
    doc = next((d for d in documents if d['id'] == doc_id), None)
    if doc:
        doc['status'] = new_status
        doc['last_updated'] = datetime.now().strftime('%d.%m.%Y %H:%M')
        emit('document_updated', doc, broadcast=True)
        emit('notification', {
            'id': str(uuid.uuid4()),
            'title': 'Document Status Update',
            'message': f"Document {doc['name']} status updated to {new_status}",
            'type': 'info',
            'timestamp': datetime.now().strftime('%d.%m.%Y %H:%M')
        }, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000)