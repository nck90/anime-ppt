const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');
const pptx2json = require('pptx2json');
const sharp = require('sharp');

const app = express();
const port = process.env.PORT || 8443;

// 데이터베이스 설정
const db = new sqlite3.Database('courses.db', (err) => {
    if (err) {
        console.error('데이터베이스 연결 오류:', err);
    } else {
        console.log('데이터베이스 연결 성공');
        // courses 테이블 생성
        db.run(`CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            thumbnail TEXT,
            category TEXT,
            ppt_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // 기존 테이블에 ppt_path 컬럼이 없으면 추가
        db.all("PRAGMA table_info(courses)", (err, rows) => {
            if (err) {
                console.error('테이블 정보 조회 오류:', err);
            } else {
                const hasPptPathColumn = rows.some(row => row.name === 'ppt_path');
                if (!hasPptPathColumn) {
                    db.run("ALTER TABLE courses ADD COLUMN ppt_path TEXT", (err) => {
                        if (err) {
                            console.error('ppt_path 컬럼 추가 오류:', err);
                        } else {
                            console.log('ppt_path 컬럼이 추가되었습니다.');
                        }
                    });
                }
            }
        });
        
        // course_requests 테이블 생성
        db.run(`CREATE TABLE IF NOT EXISTS course_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            user_name TEXT,
            user_email TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        console.log('데이터베이스 테이블 생성 완료');
    }
});

// 파일 업로드 설정
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'slides';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, 'presentation.html');
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // HTML 파일만 허용
        if (file.mimetype === 'text/html') {
            cb(null, true);
        } else {
            cb(new Error('HTML 파일만 업로드 가능합니다.'), false);
        }
    }
});

// 미들웨어 설정
app.use(express.static('public'));
app.use(express.static('slides'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// PPT 파일에서 첫 슬라이드를 이미지로 변환하는 함수
async function convertFirstSlideToImage(pptPath) {
    try {
        // PPT 파일을 JSON으로 변환
        const pptxJson = await pptx2json(pptPath);
        
        // 첫 번째 슬라이드의 이미지 데이터 추출
        const firstSlide = pptxJson.slides[0];
        if (!firstSlide || !firstSlide.images || firstSlide.images.length === 0) {
            return null;
        }
        
        // 이미지 데이터를 파일로 저장
        const imageData = firstSlide.images[0].data;
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        // 이미지 최적화 및 저장
        const thumbnailPath = path.join('public', 'thumbnails', path.basename(pptPath, path.extname(pptPath)) + '.jpg');
        
        // thumbnails 디렉토리가 없으면 생성
        if (!fs.existsSync(path.join('public', 'thumbnails'))) {
            fs.mkdirSync(path.join('public', 'thumbnails'), { recursive: true });
        }
        
        // 이미지 처리 및 저장
        await sharp(imageBuffer)
            .resize(800, 450, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);
        
        return '/thumbnails/' + path.basename(thumbnailPath);
    } catch (error) {
        console.error('슬라이드 변환 오류:', error);
        return null;
    }
}

// 슬라이드 파일 경로 설정
const SLIDES_DIR = 'slides';
const PRESENTATION_FILE = 'presentation.html';

// 슬라이드 파일 존재 여부 확인
function checkSlidesExist() {
    return fs.existsSync(path.join(SLIDES_DIR, PRESENTATION_FILE));
}

// 관리자 인증 미들웨어
const adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('인증이 필요합니다.');
    }
    
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const username = auth[0];
    const password = auth[1];
    
    // 관리자 계정 정보 (실제 운영 환경에서는 환경 변수나 보안된 설정 파일에서 관리해야 합니다)
    const ADMIN_USERNAME = 'admin';
    const ADMIN_PASSWORD = 'masppt2024';
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('인증이 필요합니다.');
    }
};

// 라우트 설정
app.get('/', (req, res) => {
    db.all("SELECT * FROM courses ORDER BY created_at DESC", (err, courses) => {
        if (err) {
            console.error('강의 목록 조회 오류:', err);
            res.status(500).send('서버 오류가 발생했습니다.');
        } else {
            res.render('index', { courses: courses || [] });
        }
    });
});

app.get('/courses', (req, res) => {
    db.all("SELECT * FROM courses ORDER BY created_at DESC", (err, courses) => {
        if (err) {
            console.error('강의 목록 조회 오류:', err);
            res.status(500).send('서버 오류가 발생했습니다.');
        } else {
            res.render('courses', { courses: courses || [] });
        }
    });
});

app.get('/categories', (req, res) => {
    db.all("SELECT * FROM courses ORDER BY created_at DESC", (err, courses) => {
        if (err) {
            console.error('강의 목록 조회 오류:', err);
            res.status(500).send('서버 오류가 발생했습니다.');
        } else {
            res.render('categories', { courses: courses || [] });
        }
    });
});

app.get('/about', (req, res) => {
    res.render('about');
});

// 프레젠테이션 페이지 라우트
app.get('/presentation/:id', (req, res) => {
    const courseId = req.params.id;
    
    db.get('SELECT * FROM courses WHERE id = ?', [courseId], (err, course) => {
        if (err) {
            console.error('강의 조회 오류:', err);
            return res.status(500).send('강의 조회 중 오류가 발생했습니다.');
        }
        
        if (!course) {
            return res.status(404).send('강의를 찾을 수 없습니다.');
        }
        
        // 슬라이드 파일 존재 여부 확인
        if (!checkSlidesExist()) {
            return res.status(404).send('슬라이드 파일이 존재하지 않습니다.');
        }
        
        // 프레젠테이션 파일 전송
        res.sendFile(path.join(__dirname, SLIDES_DIR, PRESENTATION_FILE));
    });
});

// 슬라이드 파일 라우트
app.get('/slides/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, SLIDES_DIR, filename);
    
    // 파일 존재 여부 확인
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('파일을 찾을 수 없습니다.');
    }
});

// 강의 업로드 API
app.post('/api/courses', adminAuth, async (req, res) => {
    const { title, description, category } = req.body;
    
    if (!title) {
        return res.status(400).json({ success: false, message: '제목은 필수입니다.' });
    }
    
    // 슬라이드 파일 존재 여부 확인
    if (!checkSlidesExist()) {
        return res.status(400).json({ success: false, message: '슬라이드 파일이 존재하지 않습니다.' });
    }
    
    try {
        // 강의 정보 저장
        db.run(`INSERT INTO courses (title, description, category, ppt_path) 
                VALUES (?, ?, ?, ?)`,
            [title, description, category, path.join(SLIDES_DIR, PRESENTATION_FILE)],
            function(err) {
                if (err) {
                    console.error('강의 저장 오류:', err);
                    return res.status(500).json({ success: false, message: '강의 저장 중 오류가 발생했습니다.' });
                }
                
                res.json({ 
                    success: true, 
                    message: '강의가 성공적으로 저장되었습니다.',
                    courseId: this.lastID
                });
            }
        );
    } catch (error) {
        console.error('강의 업로드 오류:', error);
        res.status(500).json({ success: false, message: '강의 업로드 중 오류가 발생했습니다.' });
    }
});

// 강의 삭제 API
app.delete('/api/courses/:id', adminAuth, (req, res) => {
    const courseId = req.params.id;
    
    db.get('SELECT ppt_path FROM courses WHERE id = ?', [courseId], (err, course) => {
        if (err) {
            return res.status(500).json({ error: '강의 조회 중 오류가 발생했습니다.' });
        }
        
        if (course && course.ppt_path) {
            fs.unlink(course.ppt_path, (err) => {
                if (err) console.error('PPT 파일 삭제 오류:', err);
            });
        }
        
        db.run('DELETE FROM courses WHERE id = ?', [courseId], (err) => {
            if (err) {
                return res.status(500).json({ error: '강의 삭제 중 오류가 발생했습니다.' });
            }
            res.json({ success: true });
        });
    });
});

// 강의 수정 API
app.put('/api/courses/:id', adminAuth, async (req, res) => {
    const courseId = req.params.id;
    const { title, description, category } = req.body;
    
    if (!title) {
        return res.status(400).json({ success: false, message: '제목은 필수입니다.' });
    }
    
    try {
        // 기존 강의 정보 조회
        db.get('SELECT ppt_path FROM courses WHERE id = ?', [courseId], (err, course) => {
            if (err) {
                console.error('강의 조회 오류:', err);
                return res.status(500).json({ success: false, message: '강의 조회 중 오류가 발생했습니다.' });
            }
            
            if (!course) {
                return res.status(404).json({ success: false, message: '강의를 찾을 수 없습니다.' });
            }
            
            // 슬라이드 파일 존재 여부 확인
            if (!checkSlidesExist()) {
                return res.status(400).json({ success: false, message: '슬라이드 파일이 존재하지 않습니다.' });
            }
            
            // 강의 정보 업데이트
            db.run(`UPDATE courses 
                    SET title = ?, description = ?, category = ?, ppt_path = ?
                    WHERE id = ?`,
                [title, description, category, path.join(SLIDES_DIR, PRESENTATION_FILE), courseId],
                function(err) {
                    if (err) {
                        console.error('강의 업데이트 오류:', err);
                        return res.status(500).json({ success: false, message: '강의 업데이트 중 오류가 발생했습니다.' });
                    }
                    
                    res.json({ 
                        success: true, 
                        message: '강의가 성공적으로 업데이트되었습니다.',
                        courseId: courseId
                    });
                }
            );
        });
    } catch (error) {
        console.error('강의 업데이트 오류:', error);
        res.status(500).json({ success: false, message: '강의 업데이트 중 오류가 발생했습니다.' });
    }
});

// 강의 요청 페이지 라우트
app.get('/request-course', (req, res) => {
    res.render('request-course');
});

// 강의 요청 제출 API
app.post('/api/course-requests', (req, res) => {
    const { title, description, category, userName, userEmail } = req.body;
    
    if (!title || !userName || !userEmail) {
        return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }
    
    db.run(
        `INSERT INTO course_requests (title, description, category, user_name, user_email) 
         VALUES (?, ?, ?, ?, ?)`,
        [title, description, category, userName, userEmail],
        function(err) {
            if (err) {
                console.error('강의 요청 제출 오류:', err);
                return res.status(500).json({ error: '강의 요청 제출 중 오류가 발생했습니다.' });
            }
            
            res.json({ 
                success: true, 
                requestId: this.lastID
            });
        }
    );
});

// 강의 요청 목록 API (관리자용)
app.get('/api/course-requests', (req, res) => {
    db.all("SELECT * FROM course_requests ORDER BY created_at DESC", (err, requests) => {
        if (err) {
            console.error('강의 요청 목록 조회 오류:', err);
            res.status(500).json({ error: '강의 요청 목록 조회 중 오류가 발생했습니다.' });
        } else {
            res.json({ requests: requests || [] });
        }
    });
});

// 강의 요청 상태 업데이트 API (관리자용)
app.put('/api/course-requests/:id', adminAuth, (req, res) => {
    const requestId = req.params.id;
    const { status } = req.body;
    
    if (!status) {
        return res.status(400).json({ error: '상태 정보가 필요합니다.' });
    }
    
    db.run(
        'UPDATE course_requests SET status = ? WHERE id = ?',
        [status, requestId],
        (err) => {
            if (err) {
                return res.status(500).json({ error: '강의 요청 상태 업데이트 중 오류가 발생했습니다.' });
            }
            res.json({ success: true });
        }
    );
});

// 강의 요청 상세 정보 API
app.get('/api/course-requests/:id', (req, res) => {
    const requestId = req.params.id;
    
    db.get('SELECT * FROM course_requests WHERE id = ?', [requestId], (err, request) => {
        if (err) {
            return res.status(500).json({ error: '강의 요청 조회 중 오류가 발생했습니다.' });
        }
        
        if (!request) {
            return res.status(404).json({ error: '요청한 강의 요청을 찾을 수 없습니다.' });
        }
        
        res.json(request);
    });
});

// 어드민 페이지 라우트
app.get('/admin', adminAuth, (req, res) => {
    // 강의 요청 목록 가져오기
    db.all("SELECT * FROM course_requests ORDER BY created_at DESC", (err, courseRequests) => {
        if (err) {
            console.error('강의 요청 목록 조회 오류:', err);
            return res.status(500).send('서버 오류가 발생했습니다.');
        }
        
        // 강의 자료 목록 가져오기
        db.all("SELECT * FROM courses ORDER BY created_at DESC", (err, courses) => {
            if (err) {
                console.error('강의 목록 조회 오류:', err);
                return res.status(500).send('서버 오류가 발생했습니다.');
            }
            
            // 어드민 페이지 렌더링
            res.render('admin', { 
                courses: courses || [], 
                courseRequests: courseRequests || [] 
            });
        });
    });
});

// 서버 시작
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
    console.log('데이터베이스 연결 성공');
}); 