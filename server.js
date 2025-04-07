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
        
        // 샘플 데이터 추가 (테이블이 비어있을 경우)
        db.get("SELECT COUNT(*) as count FROM courses", (err, row) => {
            if (err) {
                console.error('데이터 확인 오류:', err);
            } else if (row.count === 0) {
                db.run(`INSERT INTO courses (title, description, category) 
                        VALUES (?, ?, ?)`,
                    ['프레젠테이션 기초', '기본적인 프레젠테이션 제작 방법을 배웁니다.', '프레젠테이션']);
            }
        });
    }
});

// 파일 업로드 설정
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // PPT 파일만 허용
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
            file.mimetype === 'application/vnd.ms-powerpoint') {
            cb(null, true);
        } else {
            cb(new Error('PPT 파일만 업로드 가능합니다.'), false);
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

// 메인 페이지 라우트
app.get('/', (req, res) => {
    db.all("SELECT * FROM courses ORDER BY created_at DESC", (err, courses) => {
        if (err) {
            console.error('강의 목록 조회 오류:', err);
            res.status(500).send('서버 오류가 발생했습니다.');
        } else {
            res.render('index', { courses: courses });
        }
    });
});

// 프레젠테이션 페이지 라우트
app.get('/presentation/:id', (req, res) => {
    const courseId = req.params.id;
    db.get("SELECT * FROM courses WHERE id = ?", [courseId], (err, course) => {
        if (err) {
            console.error('강의 조회 오류:', err);
            res.status(500).send('서버 오류가 발생했습니다.');
        } else if (!course) {
            res.status(404).send('강의를 찾을 수 없습니다.');
        } else {
            res.render('presentation', { course: course });
        }
    });
});

// 슬라이드 페이지 라우트
app.get('/slide:number', (req, res) => {
    const slideNumber = req.params.number;
    res.sendFile(path.join(__dirname, 'slides', `slide${slideNumber}.html`));
});

// PPT 파일 업로드 및 강의 추가 API
app.post('/api/courses', upload.single('ppt'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'PPT 파일이 필요합니다.' });
        }
        
        const { title, description, category } = req.body;
        const pptPath = req.file.path;
        
        // 첫 슬라이드를 이미지로 변환
        const thumbnailPath = await convertFirstSlideToImage(pptPath);
        
        // 데이터베이스에 강의 정보 저장
        db.run(
            `INSERT INTO courses (title, description, category, thumbnail, ppt_path) 
             VALUES (?, ?, ?, ?, ?)`,
            [title, description, category, thumbnailPath, pptPath],
            function(err) {
                if (err) {
                    console.error('강의 추가 오류:', err);
                    return res.status(500).json({ error: '강의 추가 중 오류가 발생했습니다.' });
                }
                
                res.json({ 
                    success: true, 
                    courseId: this.lastID,
                    thumbnail: thumbnailPath
                });
            }
        );
    } catch (error) {
        console.error('강의 추가 오류:', error);
        res.status(500).json({ error: '강의 추가 중 오류가 발생했습니다.' });
    }
});

// 서버 시작
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
    console.log('데이터베이스 연결 성공');
}); 