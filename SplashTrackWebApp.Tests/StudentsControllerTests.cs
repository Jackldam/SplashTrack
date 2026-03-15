using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SplashTrackWebApp.Areas.Identity.Data;
using SplashTrackWebApp.Controllers;
using SplashTrackWebApp.Data;
using SplashTrackWebApp.Models;

namespace SplashTrackWebApp.Tests
{
    public class StudentsControllerTests : IDisposable
    {
        private readonly ApplicationDbContext _context;
        private readonly StudentsController _controller;

        public StudentsControllerTests()
        {
            var options = new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                .Options;

            _context = new ApplicationDbContext(options);
            _controller = new StudentsController(_context);
        }

        public void Dispose()
        {
            _context.Dispose();
        }

        private Student CreateTestStudent(string firstName = "Jane", string lastName = "Doe") =>
            new Student
            {
                FirstName = firstName,
                LastName = lastName,
                DateOfBirth = new DateOnly(2000, 1, 15),
                Email = $"{firstName.ToLower()}.{lastName.ToLower()}@example.com",
                StudentNumber = "S001"
            };

        // --- Index ---

        [Fact]
        public async Task Index_ReturnsViewWithEmptyList_WhenNoStudents()
        {
            var result = await _controller.Index();

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsAssignableFrom<IEnumerable<Student>>(viewResult.Model);
            Assert.Empty(model);
        }

        [Fact]
        public async Task Index_ReturnsViewWithStudents_WhenStudentsExist()
        {
            _context.Students.Add(CreateTestStudent("Alice", "Smith"));
            _context.Students.Add(CreateTestStudent("Bob", "Jones"));
            await _context.SaveChangesAsync();

            var result = await _controller.Index();

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsAssignableFrom<IEnumerable<Student>>(viewResult.Model);
            Assert.Equal(2, model.Count());
        }

        // --- Details ---

        [Fact]
        public async Task Details_ReturnsNotFound_WhenIdIsNull()
        {
            var result = await _controller.Details(null);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Details_ReturnsNotFound_WhenStudentDoesNotExist()
        {
            var result = await _controller.Details(999);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Details_ReturnsViewWithStudent_WhenStudentExists()
        {
            var student = CreateTestStudent();
            _context.Students.Add(student);
            await _context.SaveChangesAsync();

            var result = await _controller.Details(student.Id);

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsType<Student>(viewResult.Model);
            Assert.Equal(student.Id, model.Id);
            Assert.Equal("Jane", model.FirstName);
        }

        // --- Create GET ---

        [Fact]
        public void Create_Get_ReturnsView()
        {
            var result = _controller.Create();

            Assert.IsType<ViewResult>(result);
        }

        // --- Create POST ---

        [Fact]
        public async Task Create_Post_RedirectsToIndex_WhenModelIsValid()
        {
            var student = CreateTestStudent();

            var result = await _controller.Create(student);

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);
            Assert.Equal(1, await _context.Students.CountAsync());
        }

        [Fact]
        public async Task Create_Post_ReturnsView_WhenModelIsInvalid()
        {
            _controller.ModelState.AddModelError("FirstName", "Required");
            var student = CreateTestStudent();

            var result = await _controller.Create(student);

            Assert.IsType<ViewResult>(result);
            Assert.Equal(0, await _context.Students.CountAsync());
        }

        // --- Edit GET ---

        [Fact]
        public async Task Edit_Get_ReturnsNotFound_WhenIdIsNull()
        {
            var result = await _controller.Edit(null as int?);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Edit_Get_ReturnsNotFound_WhenStudentDoesNotExist()
        {
            var result = await _controller.Edit(999);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Edit_Get_ReturnsViewWithStudent_WhenStudentExists()
        {
            var student = CreateTestStudent();
            _context.Students.Add(student);
            await _context.SaveChangesAsync();

            var result = await _controller.Edit(student.Id);

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsType<Student>(viewResult.Model);
            Assert.Equal(student.Id, model.Id);
        }

        // --- Edit POST ---

        [Fact]
        public async Task Edit_Post_UpdatesStudent_AndRedirectsToIndex()
        {
            var student = CreateTestStudent();
            _context.Students.Add(student);
            await _context.SaveChangesAsync();

            student.FirstName = "Updated";
            var result = await _controller.Edit(student.Id, student);

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);

            var updated = await _context.Students.FindAsync(student.Id);
            Assert.Equal("Updated", updated!.FirstName);
        }

        [Fact]
        public async Task Edit_Post_ReturnsNotFound_WhenIdMismatch()
        {
            var student = CreateTestStudent();
            student.Id = 5;

            var result = await _controller.Edit(99, student);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Edit_Post_ReturnsView_WhenModelIsInvalid()
        {
            var student = CreateTestStudent();
            _context.Students.Add(student);
            await _context.SaveChangesAsync();

            _controller.ModelState.AddModelError("FirstName", "Required");
            var result = await _controller.Edit(student.Id, student);

            Assert.IsType<ViewResult>(result);
        }

        // --- Delete GET ---

        [Fact]
        public async Task Delete_Get_ReturnsNotFound_WhenIdIsNull()
        {
            var result = await _controller.Delete(null);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Delete_Get_ReturnsNotFound_WhenStudentDoesNotExist()
        {
            var result = await _controller.Delete(999);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Delete_Get_ReturnsViewWithStudent_WhenStudentExists()
        {
            var student = CreateTestStudent();
            _context.Students.Add(student);
            await _context.SaveChangesAsync();

            var result = await _controller.Delete(student.Id);

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsType<Student>(viewResult.Model);
            Assert.Equal(student.Id, model.Id);
        }

        // --- DeleteConfirmed POST ---

        [Fact]
        public async Task DeleteConfirmed_RemovesStudent_AndRedirectsToIndex()
        {
            var student = CreateTestStudent();
            _context.Students.Add(student);
            await _context.SaveChangesAsync();

            var result = await _controller.DeleteConfirmed(student.Id);

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);
            Assert.Equal(0, await _context.Students.CountAsync());
        }

        [Fact]
        public async Task DeleteConfirmed_RedirectsToIndex_WhenStudentDoesNotExist()
        {
            var result = await _controller.DeleteConfirmed(999);

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);
        }
    }
}
