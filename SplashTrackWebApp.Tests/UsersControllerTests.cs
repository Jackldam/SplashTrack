using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Moq;
using SplashTrackWebApp.Areas.Identity.Data;
using SplashTrackWebApp.Controllers;
using SplashTrackWebApp.Models;

namespace SplashTrackWebApp.Tests
{
    public class UsersControllerTests
    {
        private readonly Mock<UserManager<SplashTrackUser>> _userManagerMock;
        private readonly UsersController _controller;

        public UsersControllerTests()
        {
            var store = new Mock<IUserStore<SplashTrackUser>>();
            _userManagerMock = new Mock<UserManager<SplashTrackUser>>(
                store.Object, null!, null!, null!, null!, null!, null!, null!, null!);

            _controller = new UsersController(_userManagerMock.Object);
        }

        private SplashTrackUser CreateTestUser(string id = "user-1") => new SplashTrackUser
        {
            Id = id,
            UserName = "testuser",
            Email = "test@example.com",
            FirstName = "Test",
            LastName = "User",
            DateOfBirth = new DateOnly(1990, 6, 15)
        };

        // --- Index ---

        [Fact]
        public void Index_ReturnsViewWithUserList()
        {
            var users = new List<SplashTrackUser> { CreateTestUser() }.AsQueryable();
            _userManagerMock.Setup(m => m.Users).Returns(users);

            var result = _controller.Index();

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsAssignableFrom<IEnumerable<SplashTrackUser>>(viewResult.Model);
            Assert.Single(model);
        }

        // --- Details ---

        [Fact]
        public async Task Details_ReturnsNotFound_WhenIdIsNull()
        {
            var result = await _controller.Details(null);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Details_ReturnsNotFound_WhenUserDoesNotExist()
        {
            _userManagerMock.Setup(m => m.FindByIdAsync("999")).ReturnsAsync((SplashTrackUser?)null);

            var result = await _controller.Details("999");

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Details_ReturnsViewWithUser_WhenUserExists()
        {
            var user = CreateTestUser();
            _userManagerMock.Setup(m => m.FindByIdAsync(user.Id)).ReturnsAsync(user);

            var result = await _controller.Details(user.Id);

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsType<SplashTrackUser>(viewResult.Model);
            Assert.Equal(user.Id, model.Id);
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
        public async Task Create_Post_RedirectsToIndex_WhenSuccessful()
        {
            var model = new UserCreateViewModel
            {
                UserName = "newuser",
                Email = "new@example.com",
                FirstName = "New",
                LastName = "User",
                DateOfBirth = new DateOnly(1995, 3, 20),
                Password = "Password1!",
                ConfirmPassword = "Password1!"
            };

            _userManagerMock
                .Setup(m => m.CreateAsync(It.IsAny<SplashTrackUser>(), model.Password))
                .ReturnsAsync(IdentityResult.Success);

            var result = await _controller.Create(model);

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);
        }

        [Fact]
        public async Task Create_Post_ReturnsView_WhenCreationFails()
        {
            var model = new UserCreateViewModel
            {
                UserName = "newuser",
                Email = "new@example.com",
                FirstName = "New",
                LastName = "User",
                DateOfBirth = new DateOnly(1995, 3, 20),
                Password = "weak",
                ConfirmPassword = "weak"
            };

            _userManagerMock
                .Setup(m => m.CreateAsync(It.IsAny<SplashTrackUser>(), model.Password))
                .ReturnsAsync(IdentityResult.Failed(new IdentityError { Description = "Password too weak." }));

            var result = await _controller.Create(model);

            Assert.IsType<ViewResult>(result);
            Assert.False(_controller.ModelState.IsValid);
        }

        [Fact]
        public async Task Create_Post_ReturnsView_WhenModelIsInvalid()
        {
            _controller.ModelState.AddModelError("Email", "Required");
            var model = new UserCreateViewModel
            {
                UserName = "newuser",
                Email = "",
                FirstName = "New",
                LastName = "User",
                DateOfBirth = new DateOnly(1995, 3, 20),
                Password = "Password1!",
                ConfirmPassword = "Password1!"
            };

            var result = await _controller.Create(model);

            Assert.IsType<ViewResult>(result);
        }

        // --- Edit GET ---

        [Fact]
        public async Task Edit_Get_ReturnsNotFound_WhenIdIsNull()
        {
            var result = await _controller.Edit(null as string);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Edit_Get_ReturnsNotFound_WhenUserDoesNotExist()
        {
            _userManagerMock.Setup(m => m.FindByIdAsync("999")).ReturnsAsync((SplashTrackUser?)null);

            var result = await _controller.Edit("999");

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Edit_Get_ReturnsViewWithModel_WhenUserExists()
        {
            var user = CreateTestUser();
            _userManagerMock.Setup(m => m.FindByIdAsync(user.Id)).ReturnsAsync(user);

            var result = await _controller.Edit(user.Id);

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsType<UserEditViewModel>(viewResult.Model);
            Assert.Equal(user.Id, model.Id);
        }

        // --- Edit POST ---

        [Fact]
        public async Task Edit_Post_ReturnsNotFound_WhenIdMismatch()
        {
            var model = new UserEditViewModel
            {
                Id = "user-1",
                UserName = "u",
                Email = "e@e.com",
                FirstName = "F",
                LastName = "L",
                DateOfBirth = new DateOnly(1990, 1, 1)
            };

            var result = await _controller.Edit("different-id", model);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Edit_Post_UpdatesUser_AndRedirectsToIndex()
        {
            var user = CreateTestUser();
            _userManagerMock.Setup(m => m.FindByIdAsync(user.Id)).ReturnsAsync(user);
            _userManagerMock.Setup(m => m.UpdateAsync(user)).ReturnsAsync(IdentityResult.Success);

            var model = new UserEditViewModel
            {
                Id = user.Id,
                UserName = "updateduser",
                Email = "updated@example.com",
                FirstName = "Updated",
                LastName = "User",
                DateOfBirth = new DateOnly(1990, 6, 15)
            };

            var result = await _controller.Edit(user.Id, model);

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);
        }

        [Fact]
        public async Task Edit_Post_ReturnsView_WhenUpdateFails()
        {
            var user = CreateTestUser();
            _userManagerMock.Setup(m => m.FindByIdAsync(user.Id)).ReturnsAsync(user);
            _userManagerMock.Setup(m => m.UpdateAsync(user))
                .ReturnsAsync(IdentityResult.Failed(new IdentityError { Description = "Update failed." }));

            var model = new UserEditViewModel
            {
                Id = user.Id,
                UserName = "u",
                Email = "e@e.com",
                FirstName = "F",
                LastName = "L",
                DateOfBirth = new DateOnly(1990, 1, 1)
            };

            var result = await _controller.Edit(user.Id, model);

            Assert.IsType<ViewResult>(result);
        }

        // --- Delete GET ---

        [Fact]
        public async Task Delete_Get_ReturnsNotFound_WhenIdIsNull()
        {
            var result = await _controller.Delete(null as string);

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Delete_Get_ReturnsNotFound_WhenUserDoesNotExist()
        {
            _userManagerMock.Setup(m => m.FindByIdAsync("999")).ReturnsAsync((SplashTrackUser?)null);

            var result = await _controller.Delete("999");

            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Delete_Get_ReturnsViewWithUser_WhenUserExists()
        {
            var user = CreateTestUser();
            _userManagerMock.Setup(m => m.FindByIdAsync(user.Id)).ReturnsAsync(user);

            var result = await _controller.Delete(user.Id);

            var viewResult = Assert.IsType<ViewResult>(result);
            var model = Assert.IsType<SplashTrackUser>(viewResult.Model);
            Assert.Equal(user.Id, model.Id);
        }

        // --- DeleteConfirmed POST ---

        [Fact]
        public async Task DeleteConfirmed_DeletesUser_AndRedirectsToIndex()
        {
            var user = CreateTestUser();
            _userManagerMock.Setup(m => m.FindByIdAsync(user.Id)).ReturnsAsync(user);
            _userManagerMock.Setup(m => m.DeleteAsync(user)).ReturnsAsync(IdentityResult.Success);

            var result = await _controller.DeleteConfirmed(user.Id);

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);
            _userManagerMock.Verify(m => m.DeleteAsync(user), Times.Once);
        }

        [Fact]
        public async Task DeleteConfirmed_RedirectsToIndex_WhenUserDoesNotExist()
        {
            _userManagerMock.Setup(m => m.FindByIdAsync("999")).ReturnsAsync((SplashTrackUser?)null);

            var result = await _controller.DeleteConfirmed("999");

            var redirect = Assert.IsType<RedirectToActionResult>(result);
            Assert.Equal("Index", redirect.ActionName);
            _userManagerMock.Verify(m => m.DeleteAsync(It.IsAny<SplashTrackUser>()), Times.Never);
        }
    }
}
