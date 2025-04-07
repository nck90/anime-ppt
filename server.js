const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// 정적 파일 제공
app.use(express.static('slides'));

// 메인 프레젠테이션 페이지 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'slides', 'presentation.html'));
});

// 슬라이드 페이지 라우트
app.get('/slide:number', (req, res) => {
    const slideNumber = req.params.number;
    res.sendFile(path.join(__dirname, 'slides', `slide${slideNumber}.html`));
});

// 서버 시작
app.listen(port, () => {
    console.log(`Presentation server running at http://localhost:${port}`);
}); 